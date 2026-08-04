from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.models.auth import LoginAlert, PasswordResetToken, User
from app.models.investments import Investor
from app.models.investments import utcnow
from app.security.auth import create_access_token, hash_password, is_manager, verify_password
from app.services.email_service import send_email


DEFAULT_USER_EMAILS = {
    "סהר": "sahar9shely@gmail.com",
    "מנהלת": "sahar9shely@gmail.com",
    "בר": "bar050297@gmail.com",
    "אופק": "ofek@tazrim.app",
    "אלמוג": "almog@tazrim.app",
    "שושי": "shoshi@tazrim.app",
}

MANAGER_NAME = "סהר"
MANAGER_EMAIL = "sahar9shely@gmail.com"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def create_reset_token(db: Session, user: User, purpose: str) -> PasswordResetToken:
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.purpose == purpose,
    ).update({"used_at": utcnow()}, synchronize_session=False)

    token = PasswordResetToken(
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.reset_token_hours),
    )
    db.add(token)
    db.flush()
    return token


def reset_link(token: str) -> str:
    base = settings.app_public_url.rstrip("/")
    return f"{base}/reset-password?token={token}"


def send_invite_email(db: Session, user: User) -> tuple[PasswordResetToken, str, bool]:
    token = create_reset_token(db, user, purpose="invite")
    name = user.investor.name if user.investor else user.email
    link = reset_link(token.token)
    _, delivered = send_email(
        db,
        to_email=user.email,
        subject="תזרים — הגדרת סיסמה ראשונה",
        body=(
            f"שלום {name},\n\n"
            "נוצר עבורך חשבון במערכת תזרים.\n"
            "בכניסה הראשונה עליך להגדיר סיסמה אישית דרך הקישור הבא:\n\n"
            f"{link}\n\n"
            f"הקישור בתוקף ל־{settings.reset_token_hours} שעות.\n"
            "אחרי ההגדרה תוכל/י להתחבר עם המייל והסיסמה החדשה.\n"
        ),
        kind="invite",
        meta={"user_id": user.id, "token": token.token, "link": link},
    )
    return token, link, delivered


def send_forgot_email(db: Session, user: User) -> tuple[PasswordResetToken, str, bool]:
    token = create_reset_token(db, user, purpose="forgot")
    name = user.investor.name if user.investor else user.email
    link = reset_link(token.token)
    _, delivered = send_email(
        db,
        to_email=user.email,
        subject="תזרים — שחזור סיסמה",
        body=(
            f"שלום {name},\n\n"
            "התקבלה בקשה לשחזור סיסמה.\n"
            "אם ביקשת זאת, הגדירי סיסמה חדשה בקישור:\n\n"
            f"{link}\n\n"
            f"הקישור בתוקף ל־{settings.reset_token_hours} שעות.\n"
            "אם לא ביקשת שחזור — אפשר להתעלם מהמייל.\n"
        ),
        kind="forgot",
        meta={"user_id": user.id, "token": token.token, "link": link},
    )
    return token, link, delivered


def notify_manager_login(db: Session, user: User) -> LoginAlert:
    name = user.investor.name if user.investor else user.email
    alert = LoginAlert(
        user_id=user.id,
        investor_id=user.investor_id,
        email=user.email,
        display_name=name,
        logged_in_at=utcnow(),
    )
    db.add(alert)
    db.flush()

    manager = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.role == "manager", User.is_active.is_(True))
        .first()
    )
    if manager and manager.id != user.id:
        when = alert.logged_in_at.strftime("%d/%m/%Y %H:%M")
        send_email(
            db,
            to_email=manager.email,
            subject=f"תזרים — {name} התחבר/ה למערכת",
            body=(
                f"התראת כניסה:\n\n"
                f"משתמש: {name}\n"
                f"מייל: {user.email}\n"
                f"זמן: {when}\n"
            ),
            kind="login_alert",
            meta={"alert_id": alert.id, "user_id": user.id},
        )
    return alert


def ensure_user_for_investor(
    db: Session,
    investor: Investor,
    email: Optional[str] = None,
    *,
    send_invite: bool = True,
) -> User:
    existing = db.query(User).filter(User.investor_id == investor.id).first()
    if existing:
        return existing

    chosen = normalize_email(email or DEFAULT_USER_EMAILS.get(investor.name, f"user{investor.id}@tazrim.app"))
    if db.query(User).filter(User.email == chosen).first():
        chosen = f"user{investor.id}@tazrim.app"

    user = User(
        email=chosen,
        investor_id=investor.id,
        role="manager" if investor.is_manager else "investor",
        must_reset_password=True,
        password_hash=None,
        is_active=True,
    )
    db.add(user)
    db.flush()
    if send_invite:
        send_invite_email(db, user)
    return user


def seed_users(db: Session) -> dict:
    from app.models.investments import AppSettings

    created: list[str] = []
    invited: list[str] = []
    updated: list[str] = []

    # Keep manager identity aligned with the owning account.
    manager = db.query(Investor).filter(Investor.is_manager.is_(True)).first()
    if manager and manager.name in {"מנהלת", "שחר"}:
        manager.name = MANAGER_NAME
        updated.append(f"investor:{MANAGER_NAME}")

    settings = db.query(AppSettings).first()
    if settings and settings.manager_display_name in {"מנהלת", "שחר", ""}:
        settings.manager_display_name = MANAGER_NAME

    for investor in db.query(Investor).order_by(Investor.id).all():
        before = db.query(User).filter(User.investor_id == investor.id).first()
        if before is None:
            email = MANAGER_EMAIL if investor.is_manager else None
            user = ensure_user_for_investor(db, investor, email=email, send_invite=True)
            created.append(user.email)
            invited.append(user.email)
            continue

        user = before
        desired = MANAGER_EMAIL if investor.is_manager else DEFAULT_USER_EMAILS.get(investor.name)
        # Also migrate known placeholder emails for seeded investors.
        placeholder_emails = {
            "bar@tazrim.app": "bar050297@gmail.com",
            "manager@tazrim.app": MANAGER_EMAIL,
        }
        if not investor.is_manager and user.email in placeholder_emails:
            desired = placeholder_emails[user.email]
        if investor.is_manager:
            user.role = "manager"
        if desired and user.email != normalize_email(desired):
            clash = (
                db.query(User)
                .filter(User.email == normalize_email(desired), User.id != user.id)
                .first()
            )
            if not clash:
                user.email = normalize_email(desired)
                user.must_reset_password = True
                user.password_hash = None
                send_invite_email(db, user)
                updated.append(user.email)
                invited.append(user.email)
    db.commit()
    return {"created_users": created, "invited": invited, "updated": updated}


def serialize_user(user: User) -> dict:
    email = user.email or ""
    return {
        "id": user.id,
        "email": email,
        "role": user.role,
        "investor_id": user.investor_id,
        "investor_name": user.investor.name if user.investor else "",
        "is_manager": is_manager(user),
        "is_active": bool(user.is_active),
        "must_reset_password": user.must_reset_password,
        "has_password": bool(user.password_hash),
        "email_needs_update": email.endswith("@tazrim.app") or not email,
        "last_login_at": user.last_login_at,
        "password_set_at": user.password_set_at,
    }


def login_user(db: Session, email: str, password: str) -> dict:
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.email == normalize_email(email), User.is_active.is_(True))
        .first()
    )
    if not user:
        raise ValueError("מייל או סיסמה שגויים")

    if user.must_reset_password or not user.password_hash:
        # Re-send invite to help first-time users
        _token, link, delivered = send_invite_email(db, user)
        db.commit()
        raise PermissionError(
            json.dumps(
                {
                    "message": (
                        "זו כניסה ראשונה — יש להגדיר סיסמה מהקישור."
                        if not delivered
                        else "זו כניסה ראשונה — נשלח אליך מייל להגדרת סיסמה."
                    ),
                    "reset_link": link,
                    "email_delivered": delivered,
                },
                ensure_ascii=False,
            )
        )

    if not verify_password(password, user.password_hash):
        raise ValueError("מייל או סיסמה שגויים")

    user.last_login_at = utcnow()
    notify_manager_login(db, user)
    db.commit()

    token = create_access_token(
        user_id=user.id, role=user.role, investor_id=user.investor_id
    )
    return {"access_token": token, "token_type": "bearer", "user": serialize_user(user)}


def apply_password_reset(db: Session, token_value: str, new_password: str) -> User:
    if len(new_password) < 8:
        raise ValueError("הסיסמה חייבת להכיל לפחות 8 תווים")

    token = (
        db.query(PasswordResetToken)
        .options(joinedload(PasswordResetToken.user).joinedload(User.investor))
        .filter(PasswordResetToken.token == token_value)
        .first()
    )
    if not token or token.used_at is not None:
        raise ValueError("קישור לא תקין או שכבר נוצל")

    expires = token.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise ValueError("פג תוקף הקישור — בקשי מייל חדש")

    user = token.user
    user.password_hash = hash_password(new_password)
    user.must_reset_password = False
    user.password_set_at = utcnow()
    token.used_at = utcnow()
    db.commit()
    db.refresh(user)
    return user


def request_forgot_password(db: Session, email: str) -> dict:
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.email == normalize_email(email), User.is_active.is_(True))
        .first()
    )
    # Always succeed outwardly to avoid email enumeration; still send if found.
    if not user:
        return {
            "message": "אם המייל קיים במערכת — נשלח קישור להגדרת / שחזור סיסמה",
            "reset_link": None,
            "email_delivered": False,
        }

    if not user.password_hash:
        _token, link, delivered = send_invite_email(db, user)
    else:
        _token, link, delivered = send_forgot_email(db, user)
    db.commit()

    if delivered:
        message = "נשלח קישור למייל שלך להגדרת / שחזור סיסמה"
    else:
        message = (
            "שירות המייל עדיין לא מחובר — השתמשי בקישור למטה להגדרת הסיסמה "
            "(אותו קישור שנשלח גם לתיבת המיילים במערכת)."
        )
    return {
        "message": message,
        "reset_link": link,
        "email_delivered": delivered,
    }