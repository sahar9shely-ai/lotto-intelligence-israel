from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.db.investment_session import get_investment_db
from app.models.auth import EmailOutbox, LoginAlert, User
from app.models.investments import Investor, utcnow
from app.schemas.auth import (
    CreateAccessUserRequest,
    EmailOutboxOut,
    FulfillPasswordResetRequest,
    LoginAlertOut,
    LoginRequest,
    MessageOut,
    PasswordResetRequestOut,
    RequestPasswordResetRequest,
    SetPasswordRequest,
    TokenResponse,
    UpdateUserRequest,
    UserOut,
)
from app.security.auth import get_current_user, require_manager
from app.services import auth_service as auth_svc
from app.services import investment_service as inv_svc

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_investment_db)):
    try:
        return auth_svc.login_user(db, payload.username, payload.password)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/request-password-reset", response_model=MessageOut)
def request_password_reset(
    payload: RequestPasswordResetRequest,
    db: Session = Depends(get_investment_db),
):
    """Client asks manager to reset password — no self-service link."""
    return auth_svc.request_password_reset(db, payload.username, payload.note)


@router.get("/password-reset-requests", response_model=list[PasswordResetRequestOut])
def list_password_reset_requests(
    pending_only: bool = True,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return auth_svc.list_password_reset_requests(db, pending_only=pending_only)


@router.post(
    "/password-reset-requests/{request_id}/fulfill",
    response_model=PasswordResetRequestOut,
)
def fulfill_password_reset(
    request_id: int,
    payload: FulfillPasswordResetRequest,
    current: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    try:
        return auth_svc.fulfill_password_reset(
            db, request_id, new_password=payload.new_password, actor=current
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/password-reset-requests/{request_id}/reject",
    response_model=PasswordResetRequestOut,
)
def reject_password_reset(
    request_id: int,
    current: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    try:
        return auth_svc.reject_password_reset(db, request_id, actor=current)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/users/{user_id}/password", response_model=UserOut)
def set_user_password(
    user_id: int,
    payload: SetPasswordRequest,
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
    try:
        user = auth_svc.set_user_password(db, user, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return auth_svc.serialize_user(user)


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


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current: User = Depends(require_manager),
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
    if current.id == user.id:
        raise HTTPException(status_code=400, detail="לא ניתן למחוק את עצמך")
    if user.role == "manager" or bool(getattr(user.investor, "is_manager", False)):
        raise HTTPException(status_code=400, detail="לא ניתן למחוק משתמש מנהל")
    try:
        inv_svc.delete_investor_and_history(db, investor_id=user.investor_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return None


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
    try:
        username = auth_svc.validate_username(payload.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="שם המשתמש כבר בשימוש")

    email = auth_svc.normalize_email(str(payload.email) if payload.email else None)
    if email and db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="המייל כבר בשימוש")

    investor = Investor(
        name=payload.name.strip(),
        is_manager=payload.role == "manager",
        phone=payload.phone,
        notes=payload.notes,
    )
    db.add(investor)
    db.flush()
    try:
        user = auth_svc.ensure_user_for_investor(
            db,
            investor,
            username=username,
            email=email,
            password=payload.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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

    data = payload.model_dump(exclude_unset=True)

    if "username" in data and data["username"]:
        try:
            username = auth_svc.validate_username(str(data["username"]))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        clash = db.query(User).filter(User.username == username, User.id != user_id).first()
        if clash:
            raise HTTPException(status_code=400, detail="שם המשתמש כבר בשימוש")
        user.username = username

    if "email" in data:
        email = auth_svc.normalize_email(str(data["email"]) if data["email"] else None)
        if email:
            clash = db.query(User).filter(User.email == email, User.id != user_id).first()
            if clash:
                raise HTTPException(status_code=400, detail="המייל כבר בשימוש")
        user.email = email

    if "role" in data and data["role"]:
        role = data["role"]
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

    db.commit()
    db.refresh(user)
    return auth_svc.serialize_user(user)


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
    return auth_svc.seed_users(db)
