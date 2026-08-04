from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.db.investment_session import get_investment_db
from app.models.auth import EmailOutbox, LoginAlert, User
from app.models.investments import Investor, utcnow
from app.schemas.auth import (
    CreateAccessUserRequest,
    EmailOutboxOut,
    ForgotPasswordRequest,
    LoginAlertOut,
    LoginRequest,
    MessageOut,
    ResetPasswordRequest,
    TokenResponse,
    UpdateUserEmailRequest,
    UpdateUserRequest,
    UserOut,
)
from app.security.auth import get_current_user, is_manager, require_manager
from app.services import auth_service as auth_svc

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_investment_db)):
    try:
        return auth_svc.login_user(db, payload.email, payload.password)
    except PermissionError as exc:
        detail: object
        try:
            detail = json.loads(str(exc))
        except json.JSONDecodeError:
            detail = str(exc)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/forgot-password", response_model=MessageOut)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_investment_db)):
    return auth_svc.request_forgot_password(db, payload.email)


@router.post("/reset-password", response_model=MessageOut)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_investment_db)):
    try:
        auth_svc.apply_password_reset(db, payload.token, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"message": "הסיסמה עודכנה בהצלחה. אפשר להתחבר עכשיו."}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return auth_svc.serialize_user(user)


@router.get("/users", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    users = (
        db.query(User)
        .options(joinedload(User.investor))
        .order_by(User.id)
        .all()
    )
    return [auth_svc.serialize_user(u) for u in users]


@router.patch("/users/{user_id}/email", response_model=UserOut)
def update_user_email(
    user_id: int,
    payload: UpdateUserEmailRequest,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return _apply_user_update(
        db,
        user_id,
        UpdateUserRequest(email=payload.email, send_invite=True),
    )


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    current: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return _apply_user_update(db, user_id, payload, actor=current)


@router.post("/users", response_model=UserOut, status_code=201)
def create_access_user(
    payload: CreateAccessUserRequest,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    email = auth_svc.normalize_email(payload.email)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="המייל כבר בשימוש")

    investor = Investor(
        name=payload.name.strip(),
        is_manager=payload.role == "manager",
        phone=payload.phone,
        notes=payload.notes,
    )
    db.add(investor)
    db.flush()
    user = auth_svc.ensure_user_for_investor(
        db, investor, email=email, send_invite=payload.send_invite
    )
    user.role = payload.role
    investor.is_manager = payload.role == "manager"
    db.commit()
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.id == user.id)
        .one()
    )
    return auth_svc.serialize_user(user)


def _apply_user_update(
    db: Session,
    user_id: int,
    payload: UpdateUserRequest,
    actor: User | None = None,
) -> dict:
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")

    data = payload.model_dump(exclude_unset=True, exclude={"send_invite"})
    email_changed = False

    if "email" in data and data["email"]:
        email = auth_svc.normalize_email(str(data["email"]))
        clash = db.query(User).filter(User.email == email, User.id != user_id).first()
        if clash:
            raise HTTPException(status_code=400, detail="המייל כבר בשימוש")
        if email != user.email:
            user.email = email
            user.must_reset_password = True
            user.password_hash = None
            email_changed = True

    if "role" in data and data["role"]:
        role = data["role"]
        # Keep at least one manager active.
        if user.role == "manager" and role != "manager":
            other_managers = (
                db.query(User)
                .filter(User.role == "manager", User.id != user.id, User.is_active.is_(True))
                .count()
            )
            if other_managers == 0:
                raise HTTPException(
                    status_code=400,
                    detail="חייבים להשאיר לפחות מנהל אחד פעיל במערכת",
                )
        user.role = role
        if user.investor:
            user.investor.is_manager = role == "manager"

    if "is_active" in data and data["is_active"] is not None:
        if user.is_active and data["is_active"] is False:
            if actor and actor.id == user.id:
                raise HTTPException(status_code=400, detail="לא ניתן לבטל את עצמך")
            if user.role == "manager":
                other_managers = (
                    db.query(User)
                    .filter(User.role == "manager", User.id != user.id, User.is_active.is_(True))
                    .count()
                )
                if other_managers == 0:
                    raise HTTPException(
                        status_code=400,
                        detail="חייבים להשאיר לפחות מנהל אחד פעיל במערכת",
                    )
        user.is_active = bool(data["is_active"])

    if "investor_name" in data and data["investor_name"] and user.investor:
        user.investor.name = str(data["investor_name"]).strip()

    should_invite = bool(payload.send_invite) and email_changed
    if should_invite:
        auth_svc.send_invite_email(db, user)

    db.commit()
    db.refresh(user)
    return auth_svc.serialize_user(user)


@router.post("/users/{user_id}/resend-invite", response_model=MessageOut)
def resend_invite(
    user_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")
    if (user.email or "").endswith("@tazrim.app"):
        raise HTTPException(
            status_code=400,
            detail="עדכני מייל אמיתי לפני שליחת הזמנה",
        )
    _token, link, delivered = auth_svc.send_invite_email(db, user)
    db.commit()
    if delivered:
        return {"message": f"נשלח מייל הזמנה אל {user.email}", "reset_link": link, "email_delivered": True}
    return {
        "message": f"שירות המייל לא מחובר — העתיקי את הקישור ושלחי ל-{user.email}",
        "reset_link": link,
        "email_delivered": False,
    }

@router.get("/login-alerts", response_model=list[LoginAlertOut])
def list_login_alerts(
    unread_only: bool = False,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    query = db.query(LoginAlert).order_by(LoginAlert.logged_in_at.desc())
    if unread_only:
        query = query.filter(LoginAlert.read_at.is_(None))
    return query.limit(50).all()


@router.post("/login-alerts/{alert_id}/read", response_model=LoginAlertOut)
def mark_alert_read(
    alert_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    alert = db.query(LoginAlert).filter(LoginAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="התראה לא נמצאה")
    alert.read_at = utcnow()
    db.commit()
    db.refresh(alert)
    return alert


@router.post("/login-alerts/read-all", response_model=MessageOut)
def mark_all_alerts_read(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    db.query(LoginAlert).filter(LoginAlert.read_at.is_(None)).update(
        {"read_at": utcnow()}, synchronize_session=False
    )
    db.commit()
    return {"message": "כל ההתראות סומנו כנקראו"}


@router.get("/email-outbox", response_model=list[EmailOutboxOut])
def list_email_outbox(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Dev/helper: emails are stored here when SMTP is not configured."""
    return (
        db.query(EmailOutbox)
        .order_by(EmailOutbox.created_at.desc())
        .limit(40)
        .all()
    )


@router.post("/bootstrap-users", response_model=dict)
def bootstrap_users(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    # Also allow creating users for investors missing accounts
    result = auth_svc.seed_users(db)
    return result
