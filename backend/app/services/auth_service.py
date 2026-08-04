from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.models.auth import LoginAlert, PasswordResetRequest, User
from app.models.investments import Investor, utcnow
from app.security.auth import create_access_token, hash_password, is_manager, verify_password
from app.services.email_service import send_email


DEFAULT_USERNAMES = {
    "סהר": "sahar",
    "מנהלת": "sahar",
    "בר": "bar",
    "אופק": "ofek",
    "אלמוג": "almog",
    "שושי": "shoshi",
}

DEFAULT_USER_EMAILS = {
    "סהר": "sahar9shely@gmail.com",
    "מנהלת": "sahar9shely@gmail.com",
    "בר": "bar050297@gmail.com",
    "אופק": None,
    "אלמוג": None,
    "שושי": None,
}

MANAGER_NAME = "סהר"
MANAGER_USERNAME = "sahar"
MANAGER_DEMO_PASSWORD = "Sahar1234!"

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{2,64}$")


def normalize_username(username: str) -> str:
    return username.strip().lower()


def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    return email.strip().lower()


def validate_username(username: str) -> str:
    value = normalize_username(username)
    if not _USERNAME_RE.match(value):
        raise ValueError(
            "שם משתמש חייב להכיל אותיות באנגלית / ספרות / . _ - (2–64 תווים)"
        )
    return value


def username_for_investor(investor: Investor) -> str:
    mapped = DEFAULT_USERNAMES.get(investor.name)
    if mapped:
        return mapped
    # ASCII fallback from id
    return f"user{investor.id}"


def notify_manager_login(db: Session, user: User) -> LoginAlert:
    name = user.investor.name if user.investor else user.username
    alert = LoginAlert(
        user_id=user.id,
        investor_id=user.investor_id,
        email=user.email or user.username,
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
    if manager and manager.id != user.id and manager.email:
        when = alert.logged_in_at.strftime("%d/%m/%Y %H:%M")
        send_email(
            db,
            to_email=manager.email,
            subject=f"תזרים — {name} התחבר/ה למערכת",
            body=(
                f"התראת כניסה:\n\n"
                f"משתמש: {name}\n"
                f"שם משתמש: {user.username}\n"
                f"זמן: {when}\n"
            ),
            kind="login_alert",
            meta={"alert_id": alert.id, "user_id": user.id},
        )
    return alert


def set_user_password(db: Session, user: User, new_password: str) -> User:
    if len(new_password) < 8:
        raise ValueError("הסיסמה חייבת להכיל לפחות 8 תווים")
    user.password_hash = hash_password(new_password)
    user.must_reset_password = False
    user.password_set_at = utcnow()
    # Close open reset requests when manager sets a password.
    db.query(PasswordResetRequest).filter(
        PasswordResetRequest.user_id == user.id,
        PasswordResetRequest.status == "pending",
    ).update(
        {
            "status": "fulfilled",
            "resolved_at": utcnow(),
        },
        synchronize_session=False,
    )
    db.commit()
    db.refresh(user)
    return user


def ensure_user_for_investor(
    db: Session,
    investor: Investor,
    *,
    username: Optional[str] = None,
    email: Optional[str] = None,
    password: Optional[str] = None,
) -> User:
    existing = db.query(User).filter(User.investor_id == investor.id).first()
    if existing:
        return existing

    chosen_username = validate_username(username or username_for_investor(investor))
    if db.query(User).filter(User.username == chosen_username).first():
        chosen_username = validate_username(f"{chosen_username}{investor.id}")

    chosen_email = normalize_email(email)
    if chosen_email is None:
        chosen_email = normalize_email(DEFAULT_USER_EMAILS.get(investor.name))
    if chosen_email and db.query(User).filter(User.email == chosen_email).first():
        chosen_email = None
    # Keep a stable contact placeholder for DBs where email is still NOT NULL.
    if chosen_email is None:
        chosen_email = f"{chosen_username}@local.tazrim"

    user = User(
        username=chosen_username,
        email=chosen_email,
        investor_id=investor.id,
        role="manager" if investor.is_manager else "investor",
        must_reset_password=password is None,
        password_hash=hash_password(password) if password else None,
        password_set_at=utcnow() if password else None,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def seed_users(db: Session) -> dict:
    from app.models.investments import AppSettings

    created: list[str] = []
    updated: list[str] = []

    manager = db.query(Investor).filter(Investor.is_manager.is_(True)).first()
    if manager and manager.name in {"מנהלת", "שחר"}:
        manager.name = MANAGER_NAME
        updated.append(f"investor:{MANAGER_NAME}")

    settings = db.query(AppSettings).first()
    if settings and settings.manager_display_name in {"מנהלת", "שחר", ""}:
        settings.manager_display_name = MANAGER_NAME

    for investor in db.query(Investor).order_by(Investor.id).all():
        user = db.query(User).filter(User.investor_id == investor.id).first()
        desired_username = username_for_investor(investor)
        desired_email = normalize_email(
            DEFAULT_USER_EMAILS.get(investor.name)
            if not investor.is_manager
            else DEFAULT_USER_EMAILS.get(MANAGER_NAME)
        )

        if user is None:
            password = MANAGER_DEMO_PASSWORD if investor.is_manager else None
            user = ensure_user_for_investor(
                db,
                investor,
                username=desired_username,
                email=desired_email,
                password=password,
            )
            created.append(user.username)
            continue

        if investor.is_manager:
            user.role = "manager"

        # Backfill username for legacy rows migrated without one.
        if not getattr(user, "username", None):
            clash = (
                db.query(User)
                .filter(User.username == desired_username, User.id != user.id)
                .first()
            )
            user.username = desired_username if not clash else f"{desired_username}{user.id}"
            updated.append(user.username)
        elif user.username != desired_username and investor.name in DEFAULT_USERNAMES:
            clash = (
                db.query(User)
                .filter(User.username == desired_username, User.id != user.id)
                .first()
            )
            if not clash:
                user.username = desired_username
                updated.append(user.username)

        if desired_email and user.email != desired_email:
            clash = (
                db.query(User)
                .filter(User.email == desired_email, User.id != user.id)
                .first()
            )
            if not clash:
                user.email = desired_email
                updated.append(f"email:{user.username}")

        # Ensure manager always has a usable password in demo/local setups.
        if investor.is_manager and not user.password_hash:
            user.password_hash = hash_password(MANAGER_DEMO_PASSWORD)
            user.must_reset_password = False
            user.password_set_at = utcnow()
            updated.append("manager-password")

    db.commit()
    return {"created_users": created, "updated": updated}


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "investor_id": user.investor_id,
        "investor_name": user.investor.name if user.investor else "",
        "is_manager": is_manager(user),
        "is_active": bool(user.is_active),
        "must_reset_password": user.must_reset_password,
        "has_password": bool(user.password_hash),
        "last_login_at": user.last_login_at,
        "password_set_at": user.password_set_at,
    }


def login_user(db: Session, username: str, password: str) -> dict:
    uname = normalize_username(username)
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.username == uname, User.is_active.is_(True))
        .first()
    )
    if not user:
        raise ValueError("שם משתמש או סיסמה שגויים")

    if user.must_reset_password or not user.password_hash:
        raise PermissionError(
            "אין סיסמה לחשבון זה עדיין. פנה/י למנהל להגדרת סיסמה — אין איפוס עצמי."
        )

    if not verify_password(password, user.password_hash):
        raise ValueError("שם משתמש או סיסמה שגויים")

    user.last_login_at = utcnow()
    notify_manager_login(db, user)
    db.commit()

    token = create_access_token(
        user_id=user.id, role=user.role, investor_id=user.investor_id
    )
    return {"access_token": token, "token_type": "bearer", "user": serialize_user(user)}


def request_password_reset(
    db: Session, username: str, note: Optional[str] = None
) -> dict:
    """Client requests a reset — manager must fulfill it. No self-service."""
    uname = normalize_username(username)
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.username == uname, User.is_active.is_(True))
        .first()
    )
    # Always same message to avoid username enumeration.
    generic = {
        "message": (
            "אם שם המשתמש קיים — נשלחה בקשת איפוס למנהל. "
            "רק המנהל יכול להגדיר סיסמה חדשה."
        )
    }
    if not user:
        return generic

    existing = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id == user.id,
            PasswordResetRequest.status == "pending",
        )
        .first()
    )
    if existing:
        if note:
            existing.note = note.strip()[:255]
            db.commit()
        return generic

    req = PasswordResetRequest(
        user_id=user.id,
        username=user.username,
        display_name=user.investor.name if user.investor else user.username,
        status="pending",
        note=(note or "").strip()[:255] or None,
    )
    db.add(req)
    db.commit()
    return generic


def list_password_reset_requests(
    db: Session, *, pending_only: bool = True
) -> list[PasswordResetRequest]:
    query = db.query(PasswordResetRequest).order_by(PasswordResetRequest.created_at.desc())
    if pending_only:
        query = query.filter(PasswordResetRequest.status == "pending")
    return query.limit(50).all()


def fulfill_password_reset(
    db: Session,
    request_id: int,
    *,
    new_password: str,
    actor: User,
) -> PasswordResetRequest:
    req = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == request_id).first()
    if not req:
        raise ValueError("בקשה לא נמצאה")
    if req.status != "pending":
        raise ValueError("הבקשה כבר טופלה")

    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.id == req.user_id)
        .first()
    )
    if not user:
        raise ValueError("משתמש לא נמצא")

    if len(new_password) < 8:
        raise ValueError("הסיסמה חייבת להכיל לפחות 8 תווים")

    user.password_hash = hash_password(new_password)
    user.must_reset_password = False
    user.password_set_at = utcnow()
    req.status = "fulfilled"
    req.resolved_at = utcnow()
    req.resolved_by_user_id = actor.id
    db.commit()
    db.refresh(req)
    return req


def reject_password_reset(
    db: Session, request_id: int, *, actor: User
) -> PasswordResetRequest:
    req = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == request_id).first()
    if not req:
        raise ValueError("בקשה לא נמצאה")
    if req.status != "pending":
        raise ValueError("הבקשה כבר טופלה")
    req.status = "rejected"
    req.resolved_at = utcnow()
    req.resolved_by_user_id = actor.id
    db.commit()
    db.refresh(req)
    return req
