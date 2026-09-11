from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.models.auth import LoginAlert, PasswordResetRequest, User
from app.models.investments import Investor, InvestmentPlan, Payment, utcnow
from app.security.auth import create_access_token, hash_password, is_manager, verify_password
from app.services.email_service import send_email


DEFAULT_USERNAMES = {
    "מנהל מערכת": "admin",
    "מנהל": "admin",
    "מנהלת": "admin",  # legacy
    "סהר": "sahar",
    "בר": "bar",
    "אופק": "ofek",
    "אלמוג": "almog",
    "שושי": "shoshi",
}

DEFAULT_USER_EMAILS = {
    "מנהל מערכת": "sahar9shely@gmail.com",
    "מנהל": "sahar9shely@gmail.com",
    "מנהלת": "sahar9shely@gmail.com",  # legacy
    "סהר": None,
    "בר": "bar050297@gmail.com",
    "אופק": None,
    "אלמוג": None,
    "שושי": None,
}

ADMIN_INVESTOR_NAME = "מנהל מערכת"
ADMIN_USERNAME = "admin"
ADMIN_DEMO_PASSWORD = "admin1234!"
PERSONAL_INVESTOR_NAME = "סהר"
PERSONAL_USERNAME = "sahar"
MANAGER_NAME = ADMIN_INVESTOR_NAME
MANAGER_USERNAME = ADMIN_USERNAME
MANAGER_DEMO_PASSWORD = ADMIN_DEMO_PASSWORD

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
            subject=f"תזרים — {name} התחבר למערכת",
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
    user.access_password = new_password
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
        access_password=password,
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


def split_admin_and_personal_accounts(db: Session) -> dict:
    """Separate admin operator login from Sahar's personal investor portfolio.

    Safe / idempotent:
    - Does not move plans, payments, or savings rows (same investor_id for personal data).
    - Creates an empty admin shell investor + admin user when missing.
    - Downgrades personal investor to is_manager=false and sahar user to role=investor.
    """
    from app.models.investments import AppSettings

    admin_user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.username == ADMIN_USERNAME)
        .first()
    )
    personal_user = (
        db.query(User)
        .options(joinedload(User.investor))
        .filter(User.username == PERSONAL_USERNAME)
        .first()
    )
    personal_inv = db.query(Investor).filter(Investor.name == PERSONAL_INVESTOR_NAME).first()

    if personal_inv is None:
        legacy = (
            db.query(Investor)
            .filter(Investor.is_manager.is_(True), Investor.name == PERSONAL_INVESTOR_NAME)
            .first()
        )
        if legacy is not None:
            personal_inv = legacy

    if personal_inv is None and personal_user is not None:
        personal_inv = personal_user.investor

    if personal_inv is None:
        return {"status": "skipped", "reason": "personal_investor_missing"}

    if (
        admin_user
        and personal_user
        and personal_user.role == "investor"
        and not personal_inv.is_manager
        and admin_user.role == "manager"
        and admin_user.investor_id != personal_inv.id
        and admin_user.investor
        and admin_user.investor.is_manager
    ):
        return {
            "status": "already_split",
            "admin_username": admin_user.username,
            "personal_username": personal_user.username,
        }

    plan_count_before = (
        db.query(InvestmentPlan).filter(InvestmentPlan.investor_id == personal_inv.id).count()
    )
    payment_count_before = (
        db.query(Payment).filter(Payment.investor_id == personal_inv.id).count()
    )

    admin_inv = db.query(Investor).filter(Investor.name == ADMIN_INVESTOR_NAME).first()
    if admin_inv is None or (personal_inv is not None and admin_inv.id == personal_inv.id):
        admin_inv = Investor(
            name=ADMIN_INVESTOR_NAME,
            is_manager=True,
            notes="חשבון מנהל מערכת — ללא תיק השקעה אישי",
        )
        db.add(admin_inv)
        db.flush()
    else:
        admin_inv.name = ADMIN_INVESTOR_NAME
        admin_inv.is_manager = True

    personal_inv.is_manager = False

    for extra_manager in db.query(Investor).filter(
        Investor.is_manager.is_(True), Investor.id != admin_inv.id
    ):
        extra_manager.is_manager = False

    admin_email = normalize_email(DEFAULT_USER_EMAILS.get(ADMIN_INVESTOR_NAME)) or "sahar9shely@gmail.com"

    def user_on_investor(investor_id: int) -> User | None:
        return db.query(User).filter(User.investor_id == investor_id).first()

    def fresh_admin_investor() -> Investor:
        inv = Investor(
            name=ADMIN_INVESTOR_NAME,
            is_manager=True,
            notes="חשבון מנהל מערכת — ללא תיק השקעה אישי",
        )
        db.add(inv)
        db.flush()
        return inv

    if admin_user is None:
        occupant = user_on_investor(admin_inv.id)
        if occupant is not None:
            if personal_user is not None and occupant.id == personal_user.id:
                pass
            elif occupant.username == PERSONAL_USERNAME or (
                personal_user is None
                and personal_inv is not None
                and occupant.investor_id == personal_inv.id
            ):
                personal_user = occupant
            else:
                admin_user = occupant
                admin_user.role = "manager"
                if admin_user.username != ADMIN_USERNAME:
                    clash = (
                        db.query(User)
                        .filter(User.username == ADMIN_USERNAME, User.id != admin_user.id)
                        .first()
                    )
                    if not clash:
                        admin_user.username = ADMIN_USERNAME

        if admin_user is None:
            if user_on_investor(admin_inv.id) is not None:
                admin_inv = fresh_admin_investor()
            admin_user = User(
                username=ADMIN_USERNAME,
                email=admin_email,
                investor_id=admin_inv.id,
                role="manager",
                must_reset_password=True,
                is_active=True,
            )
            if not db.query(User).filter(User.email == admin_email).first():
                admin_user.email = admin_email
            else:
                admin_user.email = f"{ADMIN_USERNAME}@local.tazrim"
            db.add(admin_user)
            db.flush()
            if not admin_user.password_hash:
                admin_user.password_hash = hash_password(ADMIN_DEMO_PASSWORD)
                admin_user.must_reset_password = False
                admin_user.password_set_at = utcnow()
    else:
        occupant = user_on_investor(admin_inv.id)
        if occupant is not None and occupant.id != admin_user.id:
            admin_inv = fresh_admin_investor()
        admin_user.investor_id = admin_inv.id
        admin_user.role = "manager"

    if personal_user is None:
        personal_user = ensure_user_for_investor(
            db,
            personal_inv,
            username=PERSONAL_USERNAME,
            email=None,
            password=None,
        )
    else:
        personal_user.investor_id = personal_inv.id
        personal_user.role = "investor"

    if personal_user.email == admin_email:
        personal_user.email = f"{PERSONAL_USERNAME}@local.tazrim"
    if admin_user.email != admin_email and not db.query(User).filter(
        User.email == admin_email, User.id != admin_user.id
    ).first():
        admin_user.email = admin_email

    settings = db.query(AppSettings).first()
    if settings and settings.manager_display_name in {"מנהל", "מנהלת", "שחר", ""}:
        settings.manager_display_name = PERSONAL_INVESTOR_NAME

    db.flush()

    plan_count_after = (
        db.query(InvestmentPlan).filter(InvestmentPlan.investor_id == personal_inv.id).count()
    )
    payment_count_after = (
        db.query(Payment).filter(Payment.investor_id == personal_inv.id).count()
    )
    if plan_count_before != plan_count_after or payment_count_before != payment_count_after:
        raise RuntimeError(
            "split_admin_and_personal_accounts changed financial row counts — aborting"
        )

    db.flush()
    return {
        "status": "ok",
        "admin_username": admin_user.username,
        "personal_username": personal_user.username,
        "personal_investor_id": personal_inv.id,
        "admin_investor_id": admin_inv.id,
        "plans_preserved": plan_count_after,
        "payments_preserved": payment_count_after,
    }


def dedupe_investors_and_users(db: Session) -> dict:
    """Remove empty duplicate investors (same name) and orphaned double logins.

    Keeps the richest row (most plans/payments). Never touches admin/sahar system rows
    against each other. Safe to run on every startup.
    """
    from collections import defaultdict

    from app.models.auth import (
        LoginAlert,
        PasswordResetRequest,
        PasswordResetToken,
        User,
    )
    from app.models.investments import (
        InvestmentPlan,
        InvestmentTopupRequest,
        Payment,
        Quote,
        SavingsAction,
    )

    removed_investors: list[str] = []
    removed_users: list[str] = []

    by_name: dict[str, list[Investor]] = defaultdict(list)
    for inv in db.query(Investor).order_by(Investor.id.asc()).all():
        by_name[inv.name].append(inv)

    for name, group in by_name.items():
        if len(group) < 2:
            continue
        # Never collapse admin shell with personal portfolio even if names somehow match.
        if name in {ADMIN_INVESTOR_NAME, PERSONAL_INVESTOR_NAME}:
            # Keep the intended role row; drop empty extras with same name.
            if name == ADMIN_INVESTOR_NAME:
                preferred = [i for i in group if i.is_manager] or group
            else:
                preferred = [i for i in group if not i.is_manager] or group
            group = preferred + [i for i in group if i not in preferred]

        def score(inv: Investor) -> tuple[int, int, int]:
            plans = (
                db.query(InvestmentPlan)
                .filter(InvestmentPlan.investor_id == inv.id)
                .count()
            )
            payments = (
                db.query(Payment).filter(Payment.investor_id == inv.id).count()
            )
            return (plans, payments, -inv.id)

        ordered = sorted(group, key=score, reverse=True)
        keeper = ordered[0]
        for dup in ordered[1:]:
            plans = (
                db.query(InvestmentPlan)
                .filter(InvestmentPlan.investor_id == dup.id)
                .count()
            )
            payments = (
                db.query(Payment).filter(Payment.investor_id == dup.id).count()
            )
            if plans > 0 or payments > 0:
                # Has financial history — leave alone (manual merge needed).
                continue

            user = db.query(User).filter(User.investor_id == dup.id).first()
            if user and user.role == "manager":
                continue
            if user:
                db.query(LoginAlert).filter(
                    (LoginAlert.user_id == user.id) | (LoginAlert.investor_id == dup.id)
                ).delete(synchronize_session=False)
                db.query(PasswordResetRequest).filter(
                    PasswordResetRequest.user_id == user.id
                ).delete(synchronize_session=False)
                db.query(PasswordResetToken).filter(
                    PasswordResetToken.user_id == user.id
                ).delete(synchronize_session=False)
                removed_users.append(user.username)
                db.delete(user)
            else:
                db.query(LoginAlert).filter(LoginAlert.investor_id == dup.id).delete(
                    synchronize_session=False
                )

            db.query(InvestmentTopupRequest).filter(
                InvestmentTopupRequest.investor_id == dup.id
            ).delete(synchronize_session=False)
            db.query(SavingsAction).filter(SavingsAction.investor_id == dup.id).delete(
                synchronize_session=False
            )
            db.query(Quote).filter(Quote.converted_investor_id == dup.id).update(
                {"converted_investor_id": None}, synchronize_session=False
            )
            removed_investors.append(f"{dup.name}#{dup.id}")
            db.delete(dup)

    # Extra login rows on the same investor_id cannot exist (unique), but usernames
    # like bar / bar12 for same person name are cleaned when empty investor removed above.

    if removed_investors or removed_users:
        db.commit()
    else:
        db.flush()

    return {
        "removed_investors": removed_investors,
        "removed_users": removed_users,
    }


def seed_users(db: Session) -> dict:
    from app.models.investments import AppSettings

    created: list[str] = []
    updated: list[str] = []

    split_result = split_admin_and_personal_accounts(db)
    if split_result.get("status") == "ok":
        updated.append("split-admin-personal")

    manager = (
        db.query(Investor)
        .filter(Investor.is_manager.is_(True), Investor.name == ADMIN_INVESTOR_NAME)
        .first()
    )
    if manager and manager.name in {"מנהל", "מנהלת", "שחר"}:
        manager.name = ADMIN_INVESTOR_NAME
        updated.append(f"investor:{ADMIN_INVESTOR_NAME}")

    settings = db.query(AppSettings).first()
    if settings and settings.manager_display_name in {"מנהל", "מנהלת", "שחר", ""}:
        settings.manager_display_name = PERSONAL_INVESTOR_NAME

    for investor in db.query(Investor).order_by(Investor.id).all():
        user = db.query(User).filter(User.investor_id == investor.id).first()
        if user is None and investor.is_manager:
            linked_admin = db.query(User).filter(User.username == ADMIN_USERNAME).first()
            if linked_admin is not None:
                linked_admin.investor_id = investor.id
                linked_admin.role = "manager"
                user = linked_admin
        if user is None and investor.name == PERSONAL_INVESTOR_NAME:
            linked_personal = db.query(User).filter(User.username == PERSONAL_USERNAME).first()
            if linked_personal is not None:
                linked_personal.investor_id = investor.id
                linked_personal.role = "investor"
                user = linked_personal
        desired_username = username_for_investor(investor)
        desired_email = normalize_email(
            DEFAULT_USER_EMAILS.get(investor.name)
            if investor.name != PERSONAL_INVESTOR_NAME
            else None
        )
        if investor.is_manager:
            desired_email = normalize_email(DEFAULT_USER_EMAILS.get(ADMIN_INVESTOR_NAME))

        if user is None:
            # Avoid second login for the same person name (bar + bar12 style duplicates).
            desired_username = (
                ADMIN_USERNAME if investor.is_manager else desired_username or username_for_investor(investor)
            )
            clash_user = db.query(User).filter(User.username == desired_username).first()
            if (
                clash_user is not None
                and clash_user.investor is not None
                and clash_user.investor.name == investor.name
                and clash_user.investor_id != investor.id
            ):
                # Empty duplicate investor row — drop it instead of inventing bar{id}.
                plans = (
                    db.query(InvestmentPlan)
                    .filter(InvestmentPlan.investor_id == investor.id)
                    .count()
                )
                payments = (
                    db.query(Payment).filter(Payment.investor_id == investor.id).count()
                )
                if plans == 0 and payments == 0 and not investor.is_manager:
                    db.delete(investor)
                    updated.append(f"dropped-dup:{investor.name}")
                    continue

            password = ADMIN_DEMO_PASSWORD if investor.is_manager else None
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
        elif investor.name == PERSONAL_INVESTOR_NAME:
            user.role = "investor"

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

        # Only set an initial password when the manager account has none.
        # Never overwrite an existing password_hash — passwords change only via
        # explicit manager actions (Users page / fulfill reset request).
        if investor.is_manager and not user.password_hash:
            user.password_hash = hash_password(ADMIN_DEMO_PASSWORD)
            user.must_reset_password = False
            user.password_set_at = utcnow()
            updated.append("admin-initial-password")

    db.commit()
    return {"created_users": created, "updated": updated}


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.investor.phone if user.investor else None,
        "access_password": user.access_password,
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
            "אין סיסמה לחשבון זה עדיין. פנה למנהל להגדרת סיסמה — אין איפוס עצמי."
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
    user.access_password = new_password
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
