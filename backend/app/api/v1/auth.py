from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.db.investment_session import get_investment_db
from app.models.auth import EmailOutbox, LoginAlert, User
from app.models.investments import Investor, utcnow
from app.schemas.auth import (
    EmailOutboxOut,
    ForgotPasswordRequest,
    LoginAlertOut,
    LoginRequest,
    MessageOut,
    ResetPasswordRequest,
    TokenResponse,
    UpdateUserEmailRequest,
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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/forgot-password", response_model=MessageOut)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_investment_db)):
    auth_svc.request_forgot_password(db, payload.email)
    return {
        "message": "אם המייל קיים במערכת — נשלח קישור להגדרת / שחזור סיסמה"
    }


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
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")
    email = auth_svc.normalize_email(payload.email)
    clash = db.query(User).filter(User.email == email, User.id != user_id).first()
    if clash:
        raise HTTPException(status_code=400, detail="המייל כבר בשימוש")
    user.email = email
    user.must_reset_password = True
    user.password_hash = None
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
    auth_svc.send_invite_email(db, user)
    db.commit()
    return {"message": f"נשלח מייל הזמנה אל {user.email}"}


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
