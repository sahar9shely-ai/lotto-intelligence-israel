"""Personal assistant — read-only, AI-backed Q&A over live system data."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional

import httpx
from sqlalchemy.orm import Session, joinedload

from app.models.auth import User
from app.models.investments import (
    AppSettings,
    InvestmentPlan,
    Investor,
    Payment,
)
from app.services import assistant_retrieval as retr
from app.services import investment_service as inv_svc


FEE_PATTERNS = re.compile(
    r"(דמי\s*ניהול|עמלת?\s*ניהול|עמלת?\s*מנהל|manager\s*fee|management\s*fee|"
    r"כמה\s*לוקח(ים|ת)?\s*(המנהל|סהר)|אחוז\s*עמלה)",
    re.IGNORECASE,
)

FORBIDDEN_REPLY = (
    "אני כאן כדי לעזור לך להבין את התיק שלך — קרן, החזר חודשי וחיסכון. "
    "על נושאים אחרים כדאי לפנות ישירות למנהל."
)

HE_MONTHS = (
    "",
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
)

EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF"
    "]+"
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _settings(db: Session) -> AppSettings:
    return inv_svc.ensure_settings(db)


def assistant_configured(db: Session) -> bool:
    settings = _settings(db)
    _, key = _llm_credentials(settings)
    return bool(key)


def _llm_credentials(settings: AppSettings) -> tuple[str, str]:
    """Prefer the saved settings key; otherwise GEMINI_API_KEY / OPENAI_API_KEY on the host."""
    stored_key = (getattr(settings, "assistant_api_key", None) or "").strip()
    stored_provider = (getattr(settings, "assistant_provider", None) or "").strip().lower()
    env_openai = (os.environ.get("OPENAI_API_KEY") or "").strip()
    env_gemini = (
        os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
    ).strip()
    if stored_key:
        return (stored_provider or "gemini"), stored_key
    if stored_provider == "openai" and env_openai:
        return "openai", env_openai
    if stored_provider in {"", "gemini"} and env_gemini:
        return "gemini", env_gemini
    if env_gemini:
        return "gemini", env_gemini
    if env_openai:
        return "openai", env_openai
    return (stored_provider or "gemini"), ""


def _user_is_manager(user: User) -> bool:
    if getattr(user, "role", None) == "manager":
        return True
    inv = getattr(user, "investor", None)
    return bool(inv and getattr(inv, "is_manager", False))


def _he_month(day: date | None) -> str:
    if not day:
        return ""
    return HE_MONTHS[day.month]


def _money(value: Any) -> str:
    return f"₪{float(value or 0):,.0f}"


def _payment_brief(payment: Payment, *, include_name: bool = False) -> dict[str, Any]:
    due = payment.due_date
    brief = {
        "id": payment.id,
        "due_date": due.isoformat() if due else None,
        "month_label": _he_month(due),
        "amount": float(payment.investor_amount or 0),
        "status": payment.status,
    }
    if include_name:
        brief["investor_name"] = payment.investor.name if payment.investor else ""
        brief["investor_id"] = payment.investor_id
    return brief


def _investor_cta() -> dict[str, str]:
    return {
        "href": "/investors?action=topup",
        "label": "לבקש תוספת או מסלול",
        "intent": "topup",
    }


def _manager_cta() -> dict[str, str]:
    return {
        "href": "/quotes",
        "label": "לפתיחת הצעה חדשה",
        "intent": "quote",
    }


def build_investor_context(db: Session, *, investor_id: int) -> dict[str, Any]:
    """Portfolio snapshot for the assistant — never includes fees or other people."""
    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans).joinedload(InvestmentPlan.payments))
        .filter(Investor.id == investor_id)
        .first()
    )
    if not investor:
        raise ValueError("משקיע לא נמצא")

    today = date.today()
    plans_out = []
    for plan in investor.plans or []:
        metrics = inv_svc.plan_metrics(plan, today)
        kind, cash_rate, savings_rate = inv_svc.normalize_plan_rates(
            getattr(plan, "plan_type", None) or "monthly",
            plan.monthly_rate_percent,
            getattr(plan, "savings_rate_percent", 0.0) or 0.0,
        )
        # Strip anything fee-related — do not pass manager_fee to the model.
        plans_out.append(
            {
                "plan_id": plan.id,
                "status": plan.status,
                "plan_type": kind,
                "principal": plan.principal,
                "cash_rate_percent": cash_rate,
                "savings_rate_percent": savings_rate,
                "monthly_cash": metrics["monthly_investor_payout"],
                "monthly_savings": metrics["monthly_savings_accrual"],
                "current_savings": metrics["current_savings_balance"],
                "projected_savings_at_end": metrics["projected_savings_balance"],
                "start_date": plan.start_date.isoformat() if plan.start_date else None,
                "track_end_date": (
                    metrics["track_end_date"].isoformat()
                    if metrics.get("track_end_date")
                    else None
                ),
                "months_elapsed": metrics["months_elapsed"],
                "months_remaining": metrics["months_remaining"],
                "duration_months": metrics.get("effective_duration_months")
                or plan.duration_months,
                "paid_cash_total": metrics["paid_investor_total"],
                "paid_count": metrics["paid_count"],
            }
        )

    summary = inv_svc.serialize_investor(investor, today)
    paid = (
        db.query(Payment)
        .filter(Payment.investor_id == investor_id, Payment.status == "paid")
        .all()
    )
    open_pays = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(
            Payment.investor_id == investor_id,
            Payment.status.in_(("scheduled", "awaiting_confirmation")),
        )
        .order_by(Payment.due_date.asc(), Payment.id.asc())
        .all()
    )
    open_pays.sort(
        key=lambda p: (0 if p.status == "awaiting_confirmation" else 1, p.due_date, p.id)
    )
    awaiting = [p for p in open_pays if p.status == "awaiting_confirmation"]
    month_key = today.strftime("%Y-%m")
    this_month = [
        p for p in open_pays if p.due_date and p.due_date.strftime("%Y-%m") == month_key
    ]
    next_pay = open_pays[0] if open_pays else None
    has_active = any(p.get("status") == "active" for p in plans_out)

    tips: list[str] = []
    if awaiting:
        tips.append(
            "יש תשלום שממתין לאישור קבלה. אם ההעברה הגיעה — אפשר לאשר במסך תשלומים."
        )
    elif this_month:
        tips.append(
            f"לחודש {_he_month(today)} מתוכננת העברה. שווה לעקוב שהסכום הגיע."
        )
    if not has_active:
        tips.append("אין מסלול פעיל כרגע. אפשר לבקש מסלול חדש בעמוד המשקיעים.")
    elif today.day <= 7:
        tips.append(
            "תחילת חודש היא זמן טוב לוודא שההעברה יצאה, ואם מתאים — לשקול תוספת לקרן."
        )
    else:
        tips.append(
            "אם מתאים להרחיב את הקרן, אפשר לבקש תוספת או מסלול נוסף — בלי התחייבות מראש."
        )

    payments_live = retr.payments_for_investor(db, investor_id=investor_id)
    documents = retr.documents_brief(db, investor=investor)

    return {
        "role": "investor",
        "investor_name": investor.name,
        "investor_id": investor.id,
        "active_principal": summary["active_principal"],
        "monthly_cash": summary["monthly_cash"],
        "monthly_savings": summary["monthly_savings"],
        "monthly_total": summary["monthly_total"],
        "cash_rate_percent": summary["cash_rate_percent"],
        "savings_rate_percent": summary["savings_rate_percent"],
        "current_savings_balance": summary["current_savings_balance"],
        "projected_savings_balance": summary["projected_savings_balance"],
        "months_in_program": summary["months_in_program"],
        "lifetime_cash_paid": round(sum(p.investor_amount for p in paid), 2),
        "next_payment": _payment_brief(next_pay) if next_pay else None,
        "awaiting_confirmations": [_payment_brief(p) for p in awaiting[:6]],
        "this_month_open": [_payment_brief(p) for p in this_month[:4]],
        "open_payments": payments_live.get("open") or [],
        "recent_paid_payments": payments_live.get("recent_paid") or [],
        "documents": documents,
        "has_active_plan": has_active,
        "tips": tips[:2],
        "cta": _investor_cta(),
        "plans": plans_out,
        "privacy": {
            "may_discuss_other_investors": False,
            "may_discuss_managers": False,
            "may_discuss_fees": False,
            "may_change_system": False,
            "may_suggest_topup": True,
        },
    }


def what_if_add_principal(
    context: dict[str, Any], extra: float, months: Optional[int] = None
) -> dict[str, Any]:
    """Pure calculation: add principal to active hybrid/monthly terms (weighted)."""
    extra = max(float(extra or 0), 0)
    horizon = int(months) if months else None
    if horizon is not None and not 1 <= horizon <= 120:
        horizon = None
    active = [p for p in context.get("plans") or [] if p.get("status") == "active"]
    if not active:
        return {
            "ok": False,
            "detail": "אין מסלול פעיל לחישוב.",
            "extra": extra,
            "horizon_months": horizon,
        }

    # Apply addition proportionally across active plans by current principal.
    total_p = sum(float(p["principal"]) for p in active) or 1.0
    rows = []
    new_cash = 0.0
    new_savings = 0.0
    new_principal = 0.0
    for p in active:
        share = float(p["principal"]) / total_p
        add = round(extra * share, 2)
        prin = round(float(p["principal"]) + add, 2)
        cash = inv_svc.calc_monthly(prin, float(p["cash_rate_percent"]))
        sav = inv_svc.calc_monthly(prin, float(p["savings_rate_percent"]))
        new_principal += prin
        new_cash += cash
        new_savings += sav
        rows.append(
            {
                "plan_id": p["plan_id"],
                "principal_now": p["principal"],
                "principal_after": prin,
                "added": add,
                "monthly_cash_after": cash,
                "monthly_savings_after": sav,
            }
        )

    result = {
        "ok": True,
        "extra": extra,
        "principal_now": context.get("active_principal"),
        "principal_after": round(new_principal, 2),
        "monthly_cash_now": context.get("monthly_cash"),
        "monthly_cash_after": round(new_cash, 2),
        "monthly_savings_now": context.get("monthly_savings"),
        "monthly_savings_after": round(new_savings, 2),
        "monthly_total_after": round(new_cash + new_savings, 2),
        "plans": rows,
        "note": (
            "הערכה חוזית לפי האחוזים במסלול הפעיל — לא ייעוץ השקעות ולא הבטחת תשואה."
        ),
    }
    if horizon:
        result["horizon_months"] = horizon
        result["contractual_cash_over_horizon"] = round(new_cash * horizon, 2)
        result["contractual_savings_over_horizon"] = round(new_savings * horizon, 2)
    return result


def build_manager_context(db: Session, *, user: User) -> dict[str, Any]:
    """Full live snapshot for the manager — every book investor, no admin shell, no fees."""
    name = user.investor.name if getattr(user, "investor", None) else user.username
    own_id = user.investor_id
    own = build_investor_context(db, investor_id=own_id) if own_id else {}
    snapshot = retr.system_snapshot(db)

    awaiting = snapshot.get("awaiting_confirmations") or []
    overdue = int(snapshot.get("overdue_open_count") or 0)
    pending_topups = int(snapshot.get("pending_topup_count") or 0)
    pending_quotes = int(snapshot.get("pending_quote_count") or 0)

    tips: list[str] = []
    if awaiting:
        tips.append("יש אישורי קבלה שממתינים אצל משקיעים. אפשר לשלוח תזכורת או לפתוח את התשלום.")
    if overdue:
        tips.append("יש העברות שעבר מועדן. כדאי לטפל בהן מלוח «דחוף עכשיו» או מתשלומים.")
    if pending_topups:
        tips.append("יש בקשות מסלול פתוחות בעמוד המשקיעים.")
    if pending_quotes:
        tips.append("יש הצעות ממתינות. אפשר להשלים אותן בעמוד ההצעות.")
    if not tips:
        tips.append("אפשר לשאול על כל משקיע לפי שם, על סה״כ קרן, או לפתוח הצעה חדשה.")

    has_personal = bool(
        own.get("has_active_plan") and float(own.get("active_principal") or 0) > 0
    )

    return {
        "role": "manager",
        "investor_name": name,
        "has_personal_book": has_personal,
        "has_active_plan": has_personal,
        "active_principal": own.get("active_principal") if has_personal else None,
        "monthly_cash": own.get("monthly_cash") if has_personal else None,
        "monthly_savings": own.get("monthly_savings") if has_personal else None,
        "monthly_total": own.get("monthly_total") if has_personal else None,
        "current_savings_balance": own.get("current_savings_balance") if has_personal else None,
        "lifetime_cash_paid": own.get("lifetime_cash_paid") if has_personal else None,
        "plans": own.get("plans") if has_personal else [],
        "next_payment": own.get("next_payment") if has_personal else None,
        "totals": snapshot.get("totals") or {},
        "investors": snapshot.get("investors") or [],
        "missing_this_month": snapshot.get("missing_this_month") or [],
        "overdue": snapshot.get("overdue") or [],
        "awaiting_confirmations": awaiting,
        "awaiting_count": int(snapshot.get("awaiting_count") or 0),
        "overdue_open_count": overdue,
        "pending_topup_count": pending_topups,
        "pending_topups": snapshot.get("pending_topups") or [],
        "quotes": snapshot.get("quotes") or {},
        "pending_quote_count": pending_quotes,
        "users_without_password": snapshot.get("users_without_password") or [],
        "users_must_reset_password": snapshot.get("users_must_reset_password") or [],
        "users_without_password_count": int(
            snapshot.get("users_without_password_count") or 0
        ),
        "investor_chip_names": snapshot.get("investor_chip_names")
        or [row.get("name") for row in (snapshot.get("investors") or []) if row.get("name")],
        "tips": tips[:2],
        "cta": _manager_cta(),
        "privacy": {
            "may_discuss_other_investors": True,
            "may_discuss_managers": False,
            "may_discuss_fees": False,
            "may_change_system": False,
            "may_suggest_topup": True,
        },
    }


def build_assistant_context(db: Session, *, user: User) -> dict[str, Any]:
    if _user_is_manager(user):
        return build_manager_context(db, user=user)
    if not user.investor_id:
        raise PermissionError("אין תיק מקושר למשתמש")
    return build_investor_context(db, investor_id=user.investor_id)


def _suggestions_for(context: dict[str, Any]) -> list[dict[str, str]]:
    if context.get("role") == "manager":
        return [
            {"label": "מה דורש תשומת לב", "message": "מה המצב בלוח עכשיו?"},
            {"label": "מי ממתין לאישור", "message": "מי ממתין לאישור תשלום?"},
            {"label": "סה״כ קרן", "message": "כמה קרן יש במערכת?"},
            {"label": "מי חסר החודש", "message": "מי חסר החודש?"},
        ]
    chips = [
        {"label": "מה המצב שלי", "message": "מה המצב שלי?"},
        {"label": "התשלום הבא", "message": "מתי התשלום הבא?"},
        {"label": "כמה שולם", "message": "כמה שולם לי עד עכשיו?"},
        {"label": "הוספת השקעה", "message": "איך מוסיפים השקעה או מבקשים תוספת?"},
    ]
    if context.get("awaiting_confirmations"):
        chips.insert(1, {"label": "אישור ממתין", "message": "יש לי אישור תשלום ממתין?"})
    return chips[:4]


def opening_state(db: Session, *, user: User) -> dict[str, Any]:
    context = build_assistant_context(db, user=user)
    name = context.get("investor_name") or ""
    tip = (context.get("tips") or [""])[0]
    configured = assistant_configured(db)
    if context.get("role") == "manager":
        greeting = (
            f"שלום {name}.\n"
            f"{tip}\n"
            "אפשר לשאול על כל משקיע לפי שם, סה״כ קרן, מי ממתין לאישור, "
            "מי חסר החודש, או לפתוח הצעה חדשה."
        )
        if not configured:
            greeting += (
                "\nכדי שיחה עם מודל, חברו מפתח ב«הגדרות» או GEMINI_API_KEY ב־Render."
            )
    else:
        greeting = (
            f"שלום {name}.\n"
            f"{tip}\n"
            "אפשר לשאול על התיק, התשלום הבא, או על הוספת השקעה."
        )
    return {
        "greeting": scrub_assistant_text(greeting).strip(),
        "suggestions": _suggestions_for(context),
        "cta": context.get("cta"),
        "role": context.get("role"),
        "tips": context.get("tips") or [],
        "configured": configured,
    }


def scrub_assistant_text(text: str) -> str:
    """Hard safety net: never leak fee talk even if the model slips."""
    if not text:
        return text
    if FEE_PATTERNS.search(text):
        # Replace whole reply if fee content appears.
        return FORBIDDEN_REPLY
    # Soft-redact common fee words if somehow embedded.
    cleaned = re.sub(
        r"(דמי\s*ניהול|עמלת?\s*ניהול|עמלת?\s*מנהל)[^.!\n]*[.!]?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = EMOJI_RE.sub("", cleaned)
    return cleaned.strip() or FORBIDDEN_REPLY


def system_prompt(
    investor_name: str, *, role: str = "investor", context: Optional[dict[str, Any]] = None
) -> str:
    if role == "manager":
        audience = (
            f"אתה עוזר מערכת מלא למנהל {investor_name} ב«תזרים». "
            "ענה על כל שאלה תפעולית מתוך הנתונים החיים: כל המשקיעים (חוץ ממעטפת מנהל המערכת), "
            "קרנות, מסלולים, תשלומים, ממתינים לאישור, מי חסר החודש, כמה לשלם החודש, "
            "הצעות, יתרות, משתמשים בלי סיסמה. "
            "מעטפת מנהל המערכת אינה תיק השקעה — אסור לדווח עליה «קרן 0» או סיכום תיק ריק. "
            "אם has_personal_book=false אל תסכם תיק אישי. "
            "מותר להזכיר שמות משקיעים. "
            "investor_chip_names הוא אותו רוסטר כמו שבבי המשקיעים בלוח. "
            "שמות מלאים («בר מוסרי», «אופק אלזם») מתייחסים למשקיע גם לפי שם פרטי בלבד. "
            "פעלים מגדריים («השקיעה»/«השקיע») ומליצות («רציתי לדעת כמה… עד היום») לא משנים את החיפוש. "
            "אם retrieved_investors לא ריק — זו התשובה המחייבת; ציין את הקרן וההחזר משם. "
            "אסור להגיד «אין נתונים», «לא רואה ברשימה», «איני רואה» או «לא נמצא» "
            "אם השם מופיע ב-investor_chip_names או ב-retrieved_investors. "
            "אם באמת לא נמצא אחרי חיפוש מול אותה רשימה — אמור במפורש שלא נמצא משקיע בשם הזה. "
            "כשחסר פירוט, קרא לכלי lookup_investor / system_overview / list_payments."
        )
        cta_line = (
            "כשמתאים, הצע בעדינות לפתוח הצעה חדשה או לטפל בבקשת מסלול — "
            "בלי לחץ ובלי הבטחות. הפנה ל«הצעות» או ל«משקיעים»."
        )
    else:
        audience = (
            f"אתה יועץ שיחה שקט למשקיע {investor_name} במערכת «תזרים». "
            "מדברים רק על התיק של {investor_name}: קרן, החזר, תשלומים ומסמכים שלה/שלו. "
            "אסור לענות על משקיעים אחרים. "
            "הסבר מצב, תן טיפ פרקטי, וכשמתאים הצע בעדינות תוספת לקרן עם פוטנציאל גדילה "
            "לפי האחוזים החוזיים בלבד (what_if)."
        )
        cta_line = (
            "כשמתאים לשיחה (שואלים על עוד כסף, מסלול חדש, תוספת, או אחרי סיכום רגוע), "
            "אפשר להציע בעדינות לבקש תוספת / מסלול נוסף בעמוד המשקיעים. "
            "בלי לחץ, בלי «חייבים», בלי הבטחת תשואה מעבר לאחוז החוזי."
        )
    ctx_block = ""
    if context is not None:
        ctx_block = (
            "\n\nהקשר עדכני (JSON פנימי — לא להעתיק כתבנית, לא לחזור עליו בכל תשובה):\n"
            + json.dumps(retr.json_safe(context), ensure_ascii=False, default=str)
        )
    return f"""{audience}
סגנון: private-banking lite. עברית קצרה, מדויקת, בלשון פנייה מכבדת. בלי אימוג׳י. בלי סיסמאות שיווקיות.
ענה רק לשאלה האחרונה של המשתמש. אם זו ברכה («היי»/«שלום») — שלום קצר בלי מספרים.

כללי חובה:
1. אל תמציא מספרים. השתמש רק בנתונים שסופקו בהקשר או שהוחזרו מהכלים.
2. אסור להזכיר דמי ניהול, עמלות, או כמה המנהל לוקח.
3. אסור לבצע שינויים במערכת. מותר להסביר ולהפנות למסך הקיים.
4. אם שואלים על עמלה — סרב בנימוס והפנה למנהל בלי מספרים.
5. אם סופק what_if_calculation — השתמש בו. הפרד מזומן מחיסכון. אם יש horizon_months הצג את הסכום החוזי על פני החודשים.
6. {cta_line}
7. הפרד תמיד בין החזר חודשי (מזומן) לבין צבירת חיסכון.
8. טיפ אחד לכל היותר, ורק אם הוא נובע מהמצב בהקשר.
9. אל תחזור על סיכום תיק שכבר נמסר בהיסטוריה.
10. דיסקליימר חד־פעמי בלבד, רק כשמציגים מספרים: «המספרים לפי תנאי המסלול החוזי — לא ייעוץ השקעות.»{ctx_block}"""


# Prefer free-tier-friendly models first; fall back if a model is quota-blocked.
_GEMINI_MODELS = (
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemini-2.0-flash",
)


def _friendly_model_error(status_code: int, body: str) -> str:
    """Short Hebrew error for investors — never dump raw API JSON."""
    lower = (body or "").lower()
    if status_code == 429 or "quota" in lower or "rate limit" in lower:
        return "נגמרה מכסת השיחות במודל לזמן מה. נסה שוב עוד כמה דקות."
    if status_code in {401, 403} or "api key" in lower or "permission" in lower:
        return "מפתח ה־API לא תקין או חסום. בדוק אותו בהגדרות."
    if status_code == 404:
        return "המודל לא זמין כרגע."
    return "המודל לא היה זמין כרגע. נסה שוב בעוד רגע."


ToolRunner = Callable[[str, dict[str, Any]], dict[str, Any]]


def _gemini_parts(data: dict) -> list[dict]:
    try:
        return list(data["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError, TypeError):
        return []


def _split_gemini_parts(parts: list[dict]) -> tuple[str, list[dict]]:
    texts: list[str] = []
    calls: list[dict] = []
    for part in parts:
        call = part.get("functionCall")
        if call:
            calls.append(call)
        elif part.get("text"):
            texts.append(str(part["text"]))
    return "\n".join(texts).strip(), calls


def _call_gemini(
    api_key: str,
    system: str,
    messages: list[dict],
    context: dict,
    *,
    tools: Optional[list[dict]] = None,
    tool_runner: Optional[ToolRunner] = None,
) -> str:
    del context  # already folded into the system prompt
    contents = []
    for m in messages[-16:]:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    if not contents:
        contents = [{"role": "user", "parts": [{"text": "שלום"}]}]

    last_error: Optional[Exception] = None
    with httpx.Client(timeout=45.0) as client:
        for model in _GEMINI_MODELS:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={api_key}"
            )
            local_contents = [dict(c) for c in contents]
            used_tools = bool(tools and tool_runner)
            for _round in range(4):
                payload: dict[str, Any] = {
                    "system_instruction": {"parts": [{"text": system}]},
                    "contents": local_contents,
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
                }
                if used_tools:
                    payload["tools"] = [{"functionDeclarations": tools}]
                res = client.post(url, json=payload)
                if res.status_code >= 400:
                    last_error = RuntimeError(
                        _friendly_model_error(res.status_code, res.text)
                    )
                    if used_tools and res.status_code in {400, 404}:
                        used_tools = False
                        continue
                    if res.status_code in {401, 403}:
                        raise last_error
                    break
                data = res.json()
                parts = _gemini_parts(data)
                if not parts:
                    last_error = RuntimeError("תשובת המודל לא תקינה")
                    break
                text, calls = _split_gemini_parts(parts)
                if calls and tool_runner and used_tools:
                    local_contents.append({"role": "model", "parts": parts})
                    fr_parts = []
                    for call in calls:
                        result = tool_runner(
                            str(call.get("name") or ""),
                            dict(call.get("args") or {}),
                        )
                        safe = retr.json_safe(result)
                        if not isinstance(safe, dict):
                            safe = {"result": safe}
                        fr_parts.append(
                            {
                                "functionResponse": {
                                    "name": str(call.get("name") or ""),
                                    "response": safe,
                                }
                            }
                        )
                    local_contents.append({"role": "user", "parts": fr_parts})
                    continue
                if text:
                    return text
                last_error = RuntimeError("תשובת המודל לא תקינה")
                break
    if last_error:
        raise last_error
    raise RuntimeError("המודל לא היה זמין כרגע. נסה שוב בעוד רגע.")


def _call_openai(
    api_key: str,
    system: str,
    messages: list[dict],
    context: dict,
    *,
    tools: Optional[list[dict]] = None,
    tool_runner: Optional[ToolRunner] = None,
) -> str:
    del context
    chat_messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        *[
            {"role": m["role"], "content": m["content"]}
            for m in messages[-16:]
            if m["role"] in {"user", "assistant"}
        ],
    ]
    used_tools = bool(tools and tool_runner)
    last_error: Optional[Exception] = None
    with httpx.Client(timeout=45.0) as client:
        for _round in range(4):
            payload: dict[str, Any] = {
                "model": "gpt-4o-mini",
                "temperature": 0.2,
                "messages": chat_messages,
            }
            if used_tools:
                payload["tools"] = tools
            res = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
            if res.status_code >= 400:
                last_error = RuntimeError(_friendly_model_error(res.status_code, res.text))
                if used_tools and res.status_code == 400:
                    used_tools = False
                    continue
                raise last_error
            data = res.json()
            try:
                message = data["choices"][0]["message"]
            except (KeyError, IndexError, TypeError) as exc:
                raise RuntimeError("תשובת המודל לא תקינה") from exc
            tool_calls = message.get("tool_calls") or []
            if tool_calls and tool_runner and used_tools:
                chat_messages.append(message)
                for call in tool_calls:
                    fn = call.get("function") or {}
                    raw_args = fn.get("arguments") or "{}"
                    try:
                        args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                    except (TypeError, ValueError):
                        args = {}
                    result = tool_runner(str(fn.get("name") or ""), args)
                    chat_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id"),
                            "content": json.dumps(
                                retr.json_safe(result), ensure_ascii=False, default=str
                            ),
                        }
                    )
                continue
            text = (message.get("content") or "").strip()
            if text:
                return text
            last_error = RuntimeError("תשובת המודל לא תקינה")
            break
    if last_error:
        raise last_error
    raise RuntimeError("המודל לא היה זמין כרגע. נסה שוב בעוד רגע.")


def detect_what_if_amount(text: str) -> Optional[float]:
    """Extract an added principal amount from Hebrew/English questions."""
    t = text.replace(",", "")
    patterns = [
        r"אוסי[ףפ]\s*(?:עוד\s*)?(?:סכום\s*)?(?:של\s*)?([\d.]+)",
        r"להוסיף\s*(?:עוד\s*)?([\d.]+)",
        r"אם\s+(?:אני\s+)?(?:אוסיף|נוסיף|נוסף)\s*([\d.]+)",
        r"\+\s*([\d.]+)",
        r"([\d.]+)\s*₪",
        r"what\s*if\s*(?:i\s*)?(?:add|invest)\s*([\d.]+)",
    ]
    for pat in patterns:
        m = re.search(pat, t, re.IGNORECASE)
        if m:
            try:
                val = float(m.group(1))
                if val > 0:
                    return val
            except ValueError:
                continue
    return None


def detect_what_if_months(text: str) -> Optional[int]:
    """Optional horizon: «ל-12 חודשים», «למשך 6 חודש»."""
    m = re.search(r"(?:ל[־\-]?\s*|למשך\s*|עבור\s*|במשך\s*)?(\d{1,3})\s*חודש", text)
    if not m:
        return None
    val = int(m.group(1))
    if 1 <= val <= 120:
        return val
    return None


_GREETING_RE = re.compile(
    r"^(היי+|הי+|שלום|הלו|hello|hi|hey|בוקר\s*טוב|ערב\s*טוב|מה\s*נשמע|"
    r"תודה|תודה\s+רבה|אוקיי|אוקי|ok|okay)[\s!.?]*$",
    re.I,
)


def _is_greeting(message: str) -> bool:
    return bool(_GREETING_RE.match((message or "").strip()))


def wants_pdf(text: str) -> bool:
    return bool(
        re.search(r"\bpdf\b|פי.?די.?אף|הורד(ה|ת)?\s*סיכום|סיכום\s*(ל)?הורדה", text, re.I)
    )


_MISSING_INVESTOR_RE = re.compile(
    r"(לא|אינ[יה]ן?)\s+רואה|"
    r"לא\s+נמצא|"
    r"אין\s+(?:אות[והםן]\s+)?ברשימ|"
    r"לא\s+מופיע|"
    r"אין\s+נתונים|"
    r"לא\s+קיים|"
    r"אין\s+משקיע|"
    r"אינ[והן]\s+ברשימ|"
    r"לא\s+מצאתי|"
    r"לא\s+זיהיתי|"
    r"לא\s+מוכר|"
    r"רשימת\s+המשקיעים\s+הפעילים",
)


def _enforce_grounded_name_reply(
    raw: str, context: dict[str, Any], history: list | None
) -> str:
    """Never let the model claim a chip-list investor is missing."""
    hits = context.get("retrieved_investors") or []
    if not hits:
        return raw
    if _MISSING_INVESTOR_RE.search(raw or ""):
        return _format_retrieved_investors(context, history)
    return raw


def asks_about_fees(text: str) -> bool:
    return bool(FEE_PATTERNS.search(text))


def asks_about_others(text: str) -> bool:
    return bool(
        re.search(
            r"משקיע(ים)?\s+אחר|של\s+(בר|אופק|אלמוג|שושי|סהר)|כמה\s+יש\s+ל|תיק\s+של\s+",
            text,
        )
    )


def _intent(message: str) -> str:
    t = message.strip()
    if _is_greeting(t):
        return "greeting"
    if re.search(r"מה\s+המצב\s+בלוח|תשומת\s+לב|מה\s+דורש", t):
        return "ops"
    if re.search(
        r"סה.?[\"״]?כ\s*קרן|כמה\s+קרן(\s+יש)?(\s+במערכת)?|סך\s*(ה)?כל\s*קרן|"
        r"כל\s+הקרן|קרן\s+במערכת",
        t,
    ):
        return "totals"
    if re.search(r"חסר(ה|ים)?\s+(ה)?חודש|מי\s+חסר|לא\s+הועבר\s+החודש", t):
        return "missing_month"
    if re.search(r"כמה\s+לשלם|לשלם\s+(ה)?חודש|תשלומי\s+(ה)?חודש", t):
        return "pay_month"
    if re.search(r"סטטוס\s+הצעות|הצעות\s+(ממתינות|פתוחות)|מה\s+עם\s+ההצעות", t):
        return "quotes"
    if re.search(r"בלי\s+סיסמ|ללא\s+סיסמ|אין\s+סיסמ|משתמשים\s+בלי", t):
        return "no_password"
    if re.search(r"מסמך|מסמכים|חוזה|דוח(ות)?", t):
        return "documents"
    if wants_pdf(t) or re.search(
        r"מה\s+המצב(\s+שלי)?\??$|התיק\s+שלי|מה\s+יש\s+לי|סיכום(\s+של)?(\s+ה)?תיק", t
    ):
        return "status"
    if re.search(r"תשלום\s+הבא|מתי\s+(ה)?(תשלום|ההעברה)|ההעברה\s+הבאה", t):
        return "next_payment"
    if re.search(r"כמה\s+שולם|שולם\s+לי|קיבלתי\s+עד", t):
        return "paid"
    if re.search(r"אישור|ממתין\s+לאישור", t):
        return "awaiting"
    if re.search(r"הוס[יףפ]|תוספת|מסלול\s+חדש|עוד\s+כסף|להשקיע|הצעה\s+חדשה", t):
        return "add_capital"
    if re.search(r"טיפ", t):
        return "tip"
    return "default"


def _wants_capital_cta(message: str, context: dict[str, Any]) -> bool:
    if _intent(message) in {"add_capital", "status", "ops", "tip"}:
        return True
    if context.get("role") != "manager" and not context.get("has_active_plan"):
        return True
    return False


def chat(
    db: Session,
    *,
    user: User,
    message: str,
    history: list[dict[str, str]],
) -> dict[str, Any]:
    """Answer one user message. Read-only. Scoped to the logged-in investor."""
    message = (message or "").strip()
    if not message:
        raise ValueError("נא לכתוב שאלה")

    investor_id = user.investor_id
    if not investor_id:
        raise PermissionError("אין תיק מקושר למשתמש")

    manager = _user_is_manager(user)

    if asks_about_fees(message):
        return {
            "reply": FORBIDDEN_REPLY,
            "pdf_suggested": False,
            "what_if": None,
            "configured": True,
            "cta": _manager_cta() if manager else _investor_cta(),
            "suggestions": [],
        }

    retrieval: dict[str, Any] = {}
    if not _is_greeting(message):
        retrieval = retr.retrieve_named_investors(
            db, message=message, build_portfolio=build_investor_context
        )

    if not manager:
        others = [
            row
            for row in (retrieval.get("retrieved_investors") or [])
            if row.get("id") != investor_id
        ]
        named_other = bool(
            asks_about_others(message)
            and not re.search(r"התיק\s+שלי|שלי\s+|אצלי|עבורי", message)
            and re.search(r"של\s+(בר|אופק|אלמוג|שושי)|משקיע(ים)?\s+אחר", message)
        )
        own_named = any(
            row.get("id") == investor_id
            for row in (retrieval.get("retrieved_investors") or [])
        )
        if others or (named_other and not own_named):
            return {
                "reply": "אני יכול לעזור רק לגבי התיק שלך — לא לגבי משקיעים אחרים.",
                "pdf_suggested": False,
                "what_if": None,
                "configured": True,
                "cta": _investor_cta(),
                "suggestions": [],
            }

    context = build_assistant_context(db, user=user)
    if manager and retrieval:
        context = {**context, **retrieval}
    elif not manager and retrieval:
        own_hits = [
            row
            for row in (retrieval.get("retrieved_investors") or [])
            if row.get("id") == investor_id
        ]
        if own_hits:
            context = {
                **context,
                "name_query": retrieval.get("name_query"),
                "retrieved_investors": own_hits,
            }

    what_if = None
    amount = detect_what_if_amount(message)
    months = detect_what_if_months(message)
    if amount is not None or months is not None:
        wf_ctx = context
        if manager:
            hits = context.get("retrieved_investors") or []
            if hits:
                wf_ctx = build_investor_context(db, investor_id=int(hits[0]["id"]))
            elif not context.get("has_personal_book"):
                wf_ctx = {
                    "plans": [],
                    "active_principal": 0,
                    "monthly_cash": 0,
                    "monthly_savings": 0,
                }
        what_if = what_if_add_principal(wf_ctx, amount or 0, months=months)
        context = {**context, "what_if_calculation": what_if}

    settings = _settings(db)
    provider, api_key = _llm_credentials(settings)
    attach_cta = _wants_capital_cta(message, context)
    role = context.get("role") or "investor"

    def _pack(reply: str, *, configured: bool, what_if_payload=what_if) -> dict[str, Any]:
        return {
            "reply": scrub_assistant_text(reply),
            "pdf_suggested": wants_pdf(message),
            "what_if": what_if_payload,
            "configured": configured,
            "cta": context.get("cta") if attach_cta else None,
            "suggestions": _suggestions_for(context),
        }

    named_hits = context.get("retrieved_investors") or []
    if manager and named_hits and what_if is None:
        # Deterministic numbers from the same roster the dashboard chips use.
        # Gemini must not get a chance to invent «לא רואה ברשימה».
        return _pack(_format_retrieved_investors(context, history), configured=bool(api_key))

    def tool_runner(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return retr.execute_tool(
            db,
            user=user,
            role=role,
            name=name,
            arguments=arguments,
            build_portfolio=build_investor_context,
        )

    if not api_key:
        reply = _local_reply(context, message, what_if, history=history)
        return _pack(reply, configured=False)

    msgs = [{"role": h["role"], "content": h["content"]} for h in history]
    msgs.append({"role": "user", "content": message})
    system = system_prompt(
        context["investor_name"],
        role=role,
        context=context,
    )

    try:
        if provider == "openai":
            raw = _call_openai(
                api_key,
                system,
                msgs,
                context,
                tools=retr.openai_tools(role),
                tool_runner=tool_runner,
            )
        else:
            raw = _call_gemini(
                api_key,
                system,
                msgs,
                context,
                tools=retr.gemini_tool_declarations(role),
                tool_runner=tool_runner,
            )
    except Exception as exc:
        raw = _local_reply(context, message, what_if, history=history)
        note = str(exc).strip() or "המודל לא היה זמין כרגע."
        if len(note) > 160 or "{" in note:
            note = "המודל לא היה זמין כרגע. נסה שוב בעוד רגע."
        raw += f"\n\n({note})"

    raw = _enforce_grounded_name_reply(raw, context, history)
    return _pack(raw, configured=True)


def _history_has_markers(history: list | None, markers: tuple[str, ...]) -> bool:
    if not history:
        return False
    for item in reversed(history[-8:]):
        if item.get("role") != "assistant":
            continue
        content = item.get("content") or ""
        if any(marker in content for marker in markers):
            return True
    return False


CONTRACT_DISCLAIMER = "המספרים לפי תנאי המסלול החוזי — לא ייעוץ השקעות."


def _format_retrieved_investors(context: dict, history: list | None) -> str:
    hits = context.get("retrieved_investors") or []
    query = context.get("name_query") or ""
    if not hits:
        return context.get("retrieval_note") or (
            f"לא נמצא משקיע בשם «{query}» במערכת."
            if query
            else "לא נמצא משקיע בשם הזה."
        )
    lines: list[str] = []
    first = hits[0]
    if context.get("retrieval_note") and first.get("matched_as") != query:
        lines.append(str(context["retrieval_note"]))
    for hit in hits:
        name = hit.get("name") or hit.get("matched_as") or query
        port = hit.get("portfolio") or hit
        principal = port.get("active_principal", hit.get("active_principal"))
        cash = port.get("monthly_cash", hit.get("monthly_cash"))
        sav = port.get("monthly_savings", hit.get("monthly_savings"))
        savings_bal = port.get(
            "current_savings_balance", hit.get("current_savings_balance")
        )
        lines.append(
            f"{name}: קרן פעילה {_money(principal)} · "
            f"החזר חודשי במזומן {_money(cash)} · "
            f"צבירת חיסכון חודשית {_money(sav)} · "
            f"יתרת חיסכון {_money(savings_bal)}."
        )
        if not port.get("has_active_plan") and float(principal or 0) == 0:
            lines.append(f"ל{name} אין מסלול פעיל כרגע.")
    return _with_disclaimer("\n".join(lines), history)


def _format_totals(context: dict, history: list | None) -> str:
    totals = context.get("totals") or {}
    return _with_disclaimer(
        (
            f"סה״כ קרן פעילה במערכת {_money(totals.get('total_principal'))}. "
            f"{int(totals.get('active_investors') or 0)} משקיעים פעילים, "
            f"{int(totals.get('active_plans') or 0)} מסלולים. "
            f"החזר חודשי במזומן {_money(totals.get('monthly_cash_payouts'))}, "
            f"צבירת חיסכון חודשית {_money(totals.get('monthly_savings_accruals'))}."
        ),
        history,
    )


def _format_missing_month(context: dict) -> str:
    rows = context.get("missing_this_month") or []
    if not rows:
        return "אין משקיעים שחסר להם תשלום החודש."
    parts = [
        f"{row.get('investor_name')} · {_money(row.get('amount'))}"
        for row in rows[:12]
    ]
    return "חסר החודש: " + "; ".join(parts) + "."


def _format_pay_month(context: dict, history: list | None) -> str:
    totals = context.get("totals") or {}
    count = int(totals.get("this_month_to_pay_count") or 0)
    amount = totals.get("this_month_to_pay")
    return _with_disclaimer(
        f"לחודש הזה יש לשלם {_money(amount)} ל־{count} משקיעים (תשלומים שטרם נסגרו).",
        history,
    )


def _format_quotes(context: dict) -> str:
    quotes = context.get("quotes") or {}
    counts = quotes.get("counts") or {}
    pending = int(quotes.get("pending_count") or counts.get("pending") or 0)
    approved = int(quotes.get("approved_count") or counts.get("approved") or 0)
    converted = int(quotes.get("converted_count") or counts.get("converted") or 0)
    rejected = int(quotes.get("rejected_count") or counts.get("rejected") or 0)
    return (
        f"הצעות: ממתינות {pending}, מאושרות {approved}, "
        f"הומרו {converted}, נדחו {rejected}."
    )


def _format_no_password(context: dict) -> str:
    without = context.get("users_without_password") or []
    reset = context.get("users_must_reset_password") or []
    if not without and not reset:
        return "אין משתמשים בלי סיסמה."
    lines = []
    if without:
        names = ", ".join(
            (row.get("investor_name") or row.get("username") or "")
            for row in without[:12]
        )
        lines.append(f"בלי סיסמה: {names}.")
    if reset:
        names = ", ".join(
            (row.get("investor_name") or row.get("username") or "")
            for row in reset[:12]
        )
        lines.append(f"חייבים איפוס סיסמה: {names}.")
    return " ".join(lines)


def _format_documents(context: dict) -> str:
    docs = context.get("documents") or []
    if not docs:
        return "אין מסמכים בתיק כרגע."
    titles = [str(d.get("title") or d.get("kind") or "מסמך") for d in docs[:8]]
    return "מסמכים בתיק: " + "; ".join(titles) + "."


def _with_disclaimer(text: str, history: list | None) -> str:
    if _history_has_markers(history, ("לא ייעוץ השקעות",)):
        return text
    return f"{text}\n{CONTRACT_DISCLAIMER}"


def _local_reply(
    context: dict,
    message: str,
    what_if: Optional[dict],
    history: list | None = None,
) -> str:
    """Live-data reply when LLM key is missing — numbers only from this context."""
    name = context.get("investor_name") or ""
    role = context.get("role") or "investor"
    cta = context.get("cta") or {}
    tips = context.get("tips") or []
    next_pay = context.get("next_payment")
    awaiting = context.get("awaiting_confirmations") or []
    has_personal = bool(
        context.get("has_personal_book")
        if role == "manager"
        else context.get("has_active_plan")
    )

    def ops_snapshot() -> str:
        if _history_has_markers(history, ("זה מה שעומד עכשיו",)):
            return (
                "המצב בלוח כבר מופיע למעלה. אפשר לפרט מי ממתין לאישור, "
                "או לפתוח הצעה חדשה כשיתאים."
            )
        lines = [
            f"{name}, זה מה שעומד עכשיו:",
            f"ממתינים לאישור: {int(context.get('awaiting_count') or 0)}.",
            f"העברות שעבר מועדן: {int(context.get('overdue_open_count') or 0)}.",
            f"בקשות מסלול פתוחות: {int(context.get('pending_topup_count') or 0)}.",
            f"הצעות ממתינות: {int(context.get('pending_quote_count') or 0)}.",
        ]
        for row in awaiting[:3]:
            who = row.get("investor_name") or "משקיע"
            lines.append(
                f"{who} · {row.get('month_label') or ''} · {_money(row.get('amount'))}."
            )
        if tips:
            lines.append(tips[0])
        return "\n".join(lines)

    if what_if and what_if.get("ok"):
        extra = float(what_if.get("extra") or 0)
        lines = [f"{name}, לפי החישוב החוזי על המסלול:"]
        if extra:
            lines.append(
                f"קרן היום {_money(context.get('active_principal'))} · "
                f"אחרי תוספת {_money(extra)} תהיה {_money(what_if['principal_after'])}."
            )
        else:
            lines.append(f"קרן פעילה {_money(context.get('active_principal'))}.")
        lines.append(
            f"החזר חודשי במזומן: {_money(what_if['monthly_cash_now'])} → {_money(what_if['monthly_cash_after'])}."
        )
        lines.append(
            f"צבירת חיסכון חודשית: {_money(what_if['monthly_savings_now'])} → {_money(what_if['monthly_savings_after'])}."
        )
        horizon = what_if.get("horizon_months")
        if horizon:
            lines.append(
                f"על פני {int(horizon)} חודשים לפי האחוז החוזי: "
                f"מזומן {_money(what_if.get('contractual_cash_over_horizon'))}, "
                f"חיסכון {_money(what_if.get('contractual_savings_over_horizon'))}."
            )
        lines.append("לא שיניתי כלום במערכת.")
        if extra or not has_personal:
            lines.append(f"אם מתאים, אפשר {cta.get('label', 'לבקש תוספת')}.")
        return _with_disclaimer("\n".join(lines), history)
    if what_if and not what_if.get("ok"):
        return (
            f"{what_if.get('detail') or 'אין מסלול פעיל לחישוב.'} "
            f"אפשר {cta.get('label', 'לפתוח מסלול')} כשיתאים."
        )

    intent = _intent(message)
    if role == "manager" and intent == "status" and not has_personal:
        intent = "ops"
    if role != "manager" and intent == "ops":
        intent = "status"

    if intent == "greeting":
        if role == "manager":
            return (
                f"שלום {name}. במה אפשר לעזור בלוח — ממתינים לאישור, "
                "הצעה חדשה, או בקשת מסלול?"
            )
        return (
            f"שלום {name}. אפשר לשאול על התיק, התשלום הבא, "
            "או על הוספת השקעה."
        )

    if role == "manager" and context.get("name_query"):
        return _format_retrieved_investors(context, history)

    if role == "manager" and intent == "totals":
        return _format_totals(context, history)
    if role == "manager" and intent == "missing_month":
        return _format_missing_month(context)
    if role == "manager" and intent == "pay_month":
        return _format_pay_month(context, history)
    if role == "manager" and intent == "quotes":
        return _format_quotes(context)
    if role == "manager" and intent == "no_password":
        return _format_no_password(context)

    if role == "manager" and intent in {"ops", "awaiting", "tip"}:
        if intent == "awaiting" and awaiting:
            row = awaiting[0]
            who = row.get("investor_name") or "משקיע"
            return (
                f"{who} ממתין לאישור · {row.get('month_label') or row.get('month_key') or ''} · "
                f"{_money(row.get('amount'))}."
            )
        if intent == "tip":
            return tips[0] if tips else ops_snapshot()
        return ops_snapshot()

    if role == "manager" and intent == "add_capital":
        return (
            "אפשר לפתוח הצעה חדשה בעמוד ההצעות, או לטפל בבקשת מסלול בעמוד המשקיעים. "
            "בלי לחץ — לפי השיחה עם הלקוח."
        )

    if role == "manager" and intent == "default":
        return (
            "אפשר לפרט: מי ממתין לאישור, מה דורש תשומת לב בלוח, "
            "או לפתוח הצעה חדשה."
        )

    if intent == "documents":
        return _format_documents(context)

    if intent == "next_payment":
        if not next_pay:
            return f"{name}, אין כרגע תשלום פתוח בלוח. אם מתאים להרחיב את הקרן — אפשר {cta.get('label', 'לבקש מסלול')}."
        status = "ממתין לאישור קבלה" if next_pay.get("status") == "awaiting_confirmation" else "מתוכנן"
        return (
            f"התשלום הבא: {next_pay.get('month_label') or next_pay.get('due_date')} "
            f"· {_money(next_pay.get('amount'))} · {status}."
        )

    if intent == "paid":
        return _with_disclaimer(
            f"עד עכשיו שולם במזומן {_money(context.get('lifetime_cash_paid'))}. "
            f"החזר חודשי נוכחי {_money(context.get('monthly_cash'))}, "
            f"וצבירת חיסכון חודשית {_money(context.get('monthly_savings'))}.",
            history,
        )

    if intent == "awaiting":
        if not awaiting:
            return "אין כרגע תשלום שממתין לאישור קבלה."
        row = awaiting[0]
        return (
            f"יש אישור ממתין ל{row.get('month_label') or 'חודש זה'} "
            f"בסך {_money(row.get('amount'))}. "
            "אם ההעברה הגיעה — אפשר לאשר במסך תשלומים."
        )

    if intent == "add_capital":
        return (
            "אפשר לבקש תוספת לקרן או מסלול נוסף בעמוד המשקיעים. "
            "זו בקשה בלבד — בלי התחייבות ובלי לשנות את המסלול הקיים עד שיאושר. "
            "אפשר גם לשאול «מה אם אוסיף 10000 ל-12 חודשים» כדי לראות הערכה לפי האחוזים החוזיים. "
            f"{cta.get('label', 'לבקש תוספת או מסלול')}."
        )

    if intent == "tip":
        return tips[0] if tips else "אם מתאים, אפשר לעבור על התשלום הבא או לשקול תוספת לקרן."

    if intent == "default":
        return (
            "אפשר לפרט: מצב התיק, תשלום הבא, כמה שולם, "
            "או הוספת השקעה."
        )

    if intent == "status" and _history_has_markers(history, ("זה המצב בתיק",)):
        return (
            "התיק כפי שסוכם למעלה. אם מתאים — אפשר לבקש תוספת, "
            "או לשאול מתי התשלום הבא."
        )

    lines = [
        f"{name}, זה המצב בתיק:",
        f"קרן פעילה {_money(context.get('active_principal'))}.",
        f"החזר חודשי במזומן {_money(context.get('monthly_cash'))}.",
        f"צבירת חיסכון חודשית {_money(context.get('monthly_savings'))}.",
        f"יתרת חיסכון {_money(context.get('current_savings_balance'))}.",
        f"שולם במזומן עד היום {_money(context.get('lifetime_cash_paid'))}.",
    ]
    if next_pay:
        lines.append(
            f"התשלום הבא: {next_pay.get('month_label') or next_pay.get('due_date')} "
            f"· {_money(next_pay.get('amount'))}."
        )
    if awaiting:
        lines.append("יש תשלום שממתין לאישור קבלה.")
    if tips:
        lines.append(tips[0])
    lines.append("אפשר גם להוריד סיכום ב־PDF, או לבקש תוספת אם מתאים.")
    return _with_disclaimer("\n".join(lines), history)


def summarize_conversation(
    db: Session, *, investor_name: str, messages: list[dict[str, str]]
) -> str:
    if not messages:
        return f"שיחה עם {investor_name} — ללא הודעות."
    lines = [f"סיכום שיחת עוזר אישי · {investor_name}", ""]
    for m in messages[-30:]:
        who = "משקיע" if m.get("role") == "user" else "עוזר"
        lines.append(f"· {who}: {m.get('content', '')[:400]}")
    body = "\n".join(lines)
    # Never include fee talk in summary either
    return scrub_assistant_text(body)


def notify_manager_of_summary(db: Session, *, summary: str, investor_name: str) -> dict:
    """Send conversation summary to manager via Slack (and email outbox if configured)."""
    settings = _settings(db)
    webhook = (getattr(settings, "slack_webhook_url", None) or "").strip()
    sent_slack = False
    detail = "אין webhook ל-Slack"
    if webhook:
        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    webhook,
                    json={
                        "text": (
                            f"*תזרים · סיכום שיחת עוזר אישי*\n"
                            f"משקיע: {investor_name}\n\n{summary[:3500]}"
                        )
                    },
                )
            sent_slack = res.status_code < 300
            detail = "נשלח ל-Slack" if sent_slack else f"Slack {res.status_code}"
        except Exception as exc:
            detail = f"שליחה ל-Slack נכשלה: {exc}"

    # Also stash as login-alert style note via email to manager if available
    try:
        from app.services.email_service import send_email
        from app.models.auth import User as AuthUser

        manager = (
            db.query(AuthUser)
            .join(Investor, AuthUser.investor_id == Investor.id)
            .filter(Investor.is_manager.is_(True))
            .first()
        )
        if manager and manager.email:
            send_email(
                db,
                to_email=manager.email,
                subject=f"תזרים — סיכום שיחת עוזר אישי · {investor_name}",
                body=summary,
            )
            detail = (detail + " · מייל למנהל") if detail else "מייל למנהל"
    except Exception:
        pass

    return {"sent_slack": sent_slack, "detail": detail}
