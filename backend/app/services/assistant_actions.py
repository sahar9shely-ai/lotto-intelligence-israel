"""Bounded, explicitly confirmed admin actions; never execute model instructions."""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import jwt
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.models.auth import ActivityEvent, User
from app.models.investments import Investor, Payment
from app.security.auth import is_system_admin
from app.services import activity_service, investment_service as svc, wallet_service
from app.services.assistant_retrieval import normalize_he
from app.services.israel_business_days import israel_today

ACTION_KIND = "payment_confirmation_request"
_AUDIENCE = "tazrim-assistant-payment-confirmation"
_TTL = timedelta(minutes=10)
_MONTHS = (
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט",
    "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
)
_ENGLISH_MONTHS = (
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
)
_SEND = re.compile(r"(?<!\w)(?:שלח|שלחי|שלחו|תשלח|תשלחי|תשלחו|לשלוח|send)(?!\w)", re.I)
_PAYMENT_REQUEST = re.compile(
    r"(?<!\w)(?:בקשה|בקשת|בקשות|תשלום|לתשלום|אישור|לאישור|payment|confirmation|request)(?!\w)",
    re.I,
)
_UNSAFE_CONTEXT = re.compile(
    r"(?<!\w)(?:אל|לא|בלי|ללא|איך|כיצד|האם|לדוגמה|דוגמה|מצטט|נניח|אם|"
    r"not|never|don't|dont|example|quote|if|how)(?!\w)", re.I,
)
_FILLER = frozenset({
    "שלח", "שלחי", "שלחו", "תשלח", "תשלחי", "תשלחו", "לשלוח", "בבקשה", "נא",
    "בקשה", "בקשת", "בקשות", "תשלום", "התשלום", "לתשלום", "תשלומים",
    "אישור", "האישור", "לאישור", "קבלת", "קבלה", "לקבלת", "העברה", "ההעברה",
    "על", "עבור", "של", "ל", "את", "חודש", "החודש", "לחודש", "בחודש", "לשנת",
    "שנת", "בשנת", "שנה", "לי", "שליחת", "ולשלוח", "send", "request", "payment",
    "confirmation", "receipt", "to", "for", "in", "on", "month", "please", "a", "the",
})


def _require_admin(user: User) -> None:
    if not is_system_admin(user) or getattr(user, "is_active", True) is False:
        raise PermissionError("שליחת בקשת אישור דרך העוזר זמינה למנהל המערכת בלבד")


def _reply(text: str) -> dict[str, Any]:
    return {"reply": text, "action": None}


def _period(message: str, today: date) -> tuple[int, int, str]:
    """Parse one explicit calendar month, with Israel's current year as default."""
    months: set[int] = set()
    years: set[int] = set()
    remaining = message
    numeric = re.compile(r"(?<!\d)(?:(20\d{2})[-/](0?[1-9]|1[0-2])|(0?[1-9]|1[0-2])/(20\d{2}))(?!\d)")

    def numeric_month(match: re.Match) -> str:
        years.add(int(match.group(1) or match.group(4)))
        months.add(int(match.group(2) or match.group(3)))
        return " "

    remaining = numeric.sub(numeric_month, remaining)
    for number, names in enumerate(zip(_MONTHS, _ENGLISH_MONTHS), start=1):
        pattern = re.compile(r"(?<!\w)(?:ב|ל)?(?:" + "|".join(names) + r")(?!\w)")
        if pattern.search(remaining):
            months.add(number)
            remaining = pattern.sub(" ", remaining)
    explicit_number = re.compile(r"(?<!\w)(?:חודש|לחודש|בחודש|month)\s+(0?[1-9]|1[0-2])(?!\d)")

    def numbered_month(match: re.Match) -> str:
        months.add(int(match.group(1)))
        return " "

    remaining = explicit_number.sub(numbered_month, remaining)
    if re.search(r"(?<!\w)החודש(?!\w)", remaining):
        months.add(today.month)
    for year in re.findall(r"(?<!\d)(20\d{2})(?!\d)", remaining):
        years.add(int(year))
    remaining = re.sub(r"(?<!\d)20\d{2}(?!\d)", " ", remaining)
    if len(months) != 1 or len(years) > 1:
        raise ValueError("ציין חודש אחד ושנה אחת לבקשת האישור, למשל נובמבר 2026.")
    return next(iter(months)), next(iter(years), today.year), remaining


def _recipient(db: Session, remainder: str) -> Investor:
    # The entire remaining name must match. No substring, fuzzy score, or first hit.
    words = re.findall(r"[\w\u05d0-\u05ea]+", remainder, flags=re.UNICODE)
    words = [word for word in words if word not in _FILLER]
    if not words:
        raise ValueError("ציין את שם המשקיע בבקשה הנוכחית.")
    query = " ".join(words)
    alternatives = {query}
    if query.startswith("ל"):
        alternatives.add(query[1:])
    investors = db.query(Investor).all()
    exact = [row for row in investors if normalize_he(row.name) in alternatives]
    if len(exact) == 1 and " " in query:
        return exact[0]
    if len(exact) > 1:
        raise ValueError("השם מתאים ליותר ממשקיע אחד. ציין את השם המלא.")
    first_names = [row for row in investors if normalize_he(row.name).split(" ")[0] in alternatives]
    if len(first_names) == 1:
        return first_names[0]
    if len(first_names) > 1:
        raise ValueError("השם מתאים ליותר ממשקיע אחד. ציין את השם המלא.")
    raise ValueError("לא נמצא משקיע בשם שציינת. כתוב את השם כפי שהוא מופיע בתזרים.")


def _eligible(payment: Payment, user: User) -> None:
    if payment.investor_id == user.investor_id or svc.is_admin_shell(payment.investor):
        raise ValueError("בקשת האישור דרך העוזר מיועדת לתשלום למשקיע אחר.")
    amount = payment.investor_amount
    if not math.isfinite(amount) or amount <= 0:
        raise ValueError("אין בתשלום הזה סכום מזומן למשקיע לשליחה לאישור.")
    if payment.status != "scheduled":
        raise ValueError("ניתן לשלוח לאישור רק תשלום מתוכנן.")
    if payment.paid_at is not None or payment.confirmation_requested_at is not None:
        raise ValueError("נתוני התשלום השתנו. פתח מחדש את הבקשה עם הנתונים העדכניים.")


def _snapshot(db: Session, payment: Payment) -> str:
    last_event = db.query(ActivityEvent.id).filter(
        ActivityEvent.entity_type == "payment", ActivityEvent.entity_id == payment.id,
    ).order_by(ActivityEvent.id.desc()).first()
    fields = {
        "payment_id": payment.id, "investor_id": payment.investor_id,
        "investor_name": payment.investor.name, "plan_id": payment.plan_id,
        "month_number": payment.month_number, "due_date": payment.due_date.isoformat(),
        "amount": float(payment.investor_amount), "status": payment.status,
        "paid_at": str(payment.paid_at), "requested_at": str(payment.confirmation_requested_at),
        "last_activity_id": last_event[0] if last_event else None,
    }
    return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def prepare_payment_confirmation(
    db: Session, *, user: User, message: str, today: date | None = None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Prepare a signed, read-only action card from this message alone."""
    text = normalize_he(message)
    if not (_SEND.search(text) and _PAYMENT_REQUEST.search(text)):
        return None
    # Investor/other-manager chat continues through its own private read-only flow.
    if not is_system_admin(user):
        return None
    _require_admin(user)
    if _UNSAFE_CONTEXT.search(text) or re.search(r"[\"'`«»״“”‘’]", text):
        return _reply("כדי להכין בקשת אישור, כתוב פקודה ישירה עם שם המשקיע והחודש.")
    try:
        # normalize_he treats hyphens as name separators; retain ISO month syntax.
        period_text = normalize_he(message.replace("-", "/"))
        month, year, remainder = _period(period_text, today or israel_today())
        investor = _recipient(db, remainder)
        if investor.id == user.investor_id or svc.is_admin_shell(investor):
            raise ValueError("בקשת האישור דרך העוזר מיועדת לתשלום למשקיע אחר.")
        start = date(year, month, 1)
        end = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
        payments = db.query(Payment).options(joinedload(Payment.investor)).filter(
            Payment.investor_id == investor.id, Payment.due_date >= start, Payment.due_date < end,
        ).order_by(Payment.id).all()
        month_label = f"{_MONTHS[month - 1]} {year}"
        if not payments:
            return _reply(f"לא נמצא תשלום ל{investor.name} עבור {month_label}.")
        if len(payments) != 1:
            return _reply(f"נמצאו כמה תשלומים ל{investor.name} עבור {month_label}. בחר את התשלום במסך התשלומים.")
        payment = payments[0]
        if payment.status == "awaiting_confirmation":
            return _reply(f"התשלום ל{investor.name} עבור {month_label} כבר ממתין לאישור המשקיע.")
        if payment.status == "paid":
            return _reply(f"התשלום ל{investor.name} עבור {month_label} כבר אושר ובוצע.")
        _eligible(payment, user)
        if svc.pending_date_amendment(db, payment.plan_id):
            raise svc.PendingDateAmendmentError("התשלום ממתין לחתימת הסכם עדכון מועדי המסלול. ניתן לשלוח לאישור לאחר השלמת העדכון.")
        issued = now or datetime.now(timezone.utc)
        token = jwt.encode({
            "aud": _AUDIENCE, "purpose": ACTION_KIND, "sub": str(user.id),
            "actor_investor_id": user.investor_id, "payment_id": payment.id,
            "investor_id": investor.id, "snapshot": _snapshot(db, payment),
            "jti": str(uuid4()), "iat": issued, "exp": issued + _TTL,
        }, settings.jwt_secret, algorithm="HS256")
        return {
            "reply": f"הכנתי בקשת אישור קבלת תשלום ל{investor.name} עבור {month_label}. בדוק את הפרטים ולחץ על שלח לאישור.",
            "action": {
                "token": token, "kind": ACTION_KIND, "payment_id": payment.id,
                "investor_name": investor.name, "amount": payment.investor_amount,
                "due_date": payment.due_date.isoformat(), "month_label": month_label,
            },
        }
    except ValueError as exc:
        return _reply(str(exc))


def execute_payment_confirmation(db: Session, *, user: User, token: str) -> dict[str, Any]:
    """Revalidate under the existing payment lock; send at most once per proposal."""
    _require_admin(user)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], audience=_AUDIENCE,
            options={"require": ["aud", "purpose", "sub", "actor_investor_id", "payment_id", "investor_id", "snapshot", "jti", "iat", "exp"]})
    except jwt.PyJWTError:
        raise ValueError("בקשת האישור פגה או אינה תקינה. הכן בקשה חדשה בעוזר.") from None
    if payload["purpose"] != ACTION_KIND:
        raise ValueError("בקשת האישור אינה תקינה. הכן בקשה חדשה בעוזר.")
    if payload["sub"] != str(user.id) or payload["actor_investor_id"] != user.investor_id:
        raise PermissionError("בקשת האישור אינה שייכת למנהל המחובר")
    try:
        wallet_service.begin_wallet_write(db)
        # Lock the investor first, in the same order as the existing Payments flow.
        wallet_service.lock_investor(db, payload["investor_id"])
        payment = db.query(Payment).options(joinedload(Payment.investor)).filter(
            Payment.id == payload["payment_id"], Payment.investor_id == payload["investor_id"],
        ).populate_existing().first()
        if not payment:
            raise ValueError("התשלום אינו קיים עוד. הכן בקשה חדשה.")
        svc.require_payment_dates_settled(db, payment)
        if payment.investor_id == user.investor_id or svc.is_admin_shell(payment.investor):
            raise ValueError("בקשת האישור דרך העוזר מיועדת לתשלום למשקיע אחר.")
        # Replays/concurrent clicks return current state without another notification.
        if payment.status in {"awaiting_confirmation", "paid"}:
            result = _reply("התשלום כבר ממתין לאישור המשקיע." if payment.status == "awaiting_confirmation" else "התשלום כבר אושר ובוצע.")
            result.update(payment_id=payment.id, status=payment.status)
            db.rollback()
            return result
        _eligible(payment, user)
        if payload["snapshot"] != _snapshot(db, payment):
            raise ValueError("פרטי התשלום השתנו מאז הכנת הבקשה. הכן בקשה חדשה ובדוק את הפרטים.")
        activity_service.log_activity(
            db, kind="payment_awaiting", title=f"תשלום נשלח לאישור · {payment.investor.name}",
            body="בקשת אישור קבלת תשלום נשלחה דרך העוזר האישי", severity="warning",
            actor=user, investor_id=payment.investor_id, investor_name=payment.investor.name,
            entity_type="payment", entity_id=payment.id, href=svc.payment_focus_path(payment),
            meta={"source": "personal_assistant", "action_id": payload["jti"]},
        )
        svc.request_payment_confirmation(db, payment=payment, actor=user, commit=False)
        db.commit()
        return {
            "reply": f"בקשת אישור קבלת התשלום ל{payment.investor.name} עודכנה בתזרים. התשלום ממתין לאישור המשקיע.",
            "action": None, "payment_id": payment.id, "status": payment.status,
        }
    except Exception:
        db.rollback()
        raise


# Convenient names for the HTTP/chat integration; all authority stays here.
prepare_payment_action = prepare_payment_confirmation
confirm_payment_action = execute_payment_confirmation
