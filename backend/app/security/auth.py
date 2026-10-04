from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.db.investment_session import get_investment_db
from app.models.auth import User

_bearer = HTTPBearer(auto_error=False)


def enforce_maintenance_access(user: User) -> None:
    if settings.admin_only_maintenance and not (
        user.username == settings.maintenance_admin_username and is_manager(user)
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="המערכת בעבודות תחזוקה. הגישה למשתמשים תיפתח מחדש בסיום העדכון.",
        )


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, password_hash: Optional[str]) -> bool:
    if not password_hash or not password_hash.startswith("pbkdf2_sha256$"):
        return False
    try:
        _, salt, expected = password_hash.split("$", 2)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hmac.compare_digest(digest.hex(), expected)


def create_access_token(*, user_id: int, role: str, investor_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "investor_id": investor_id,
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="פג תוקף ההתחברות או שהטוקן אינו תקין",
        ) from exc


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_investment_db),
    request: Request = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="נדרשת התחברות")
    payload = decode_access_token(credentials.credentials)
    user_id = int(payload.get("sub", 0))
    user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.id == user_id, User.is_active.is_(True))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="משתמש לא נמצא")
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="אין סיסמה לחשבון זה עדיין. פנו למנהל להגדרת סיסמה.",
        )
    enforce_maintenance_access(user)
    if request is not None:
        enforce_notification_access(user, db, request.url.path)
    return user


def enforce_notification_access(user: User, db: Session, path: str) -> None:
    """Keep activation/help accessible while investor access requires an opt-in.

    Subscription state is a product precondition, never an identity or financial
    authorization source. Normal authenticated ownership checks still apply.
    """
    if not settings.web_push_require_notifications or is_manager(user):
        return
    if path.startswith(("/api/v1/auth/", "/api/v1/push/", "/api/v1/tutorials")):
        return
    from app.services import push_service
    if not push_service.has_active_subscription(db, user):
        raise HTTPException(status_code=428, detail="יש להפעיל התראות בטלפון לפני כניסה לתיק. פתח את מסך הפעלת ההתראות.")


def require_manager(user: User = Depends(get_current_user)) -> User:
    if user.role != "manager" and not (user.investor and user.investor.is_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="למנהל בלבד")
    return user


def is_manager(user: User) -> bool:
    return user.role == "manager" or bool(user.investor and user.investor.is_manager)


def is_system_admin(user: User) -> bool:
    return user.username == "admin" and is_manager(user)


def require_system_admin(user: User = Depends(get_current_user)) -> User:
    if not is_system_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="סיום מסלול זמין למנהל המערכת בלבד")
    return user
