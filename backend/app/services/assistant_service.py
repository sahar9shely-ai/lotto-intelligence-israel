"""Personal assistant — read-only, investor-scoped, AI-backed Q&A."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session, joinedload

from app.models.auth import User
from app.models.investments import (
    AppSettings,
    InvestmentPlan,
    InvestmentTopupRequest,
    Investor,
    Payment,
    Quote,
)
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

    return {
        "role": "investor",
        "investor_name": investor.name,
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


def what_if_add_principal(context: dict[str, Any], extra: float) -> dict[str, Any]:
    """Pure calculation: add principal to active hybrid/monthly terms (weighted)."""
    extra = max(float(extra or 0), 0)
    active = [p for p in context.get("plans") or [] if p.get("status") == "active"]
    if not active:
        return {
            "ok": False,
            "detail": "אין מסלול פעיל לחישוב.",
            "extra": extra,
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

    return {
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
        "note": "חישוב הערכה לפי האחוזים הנוכחיים במסלול — לא משנה כלום במערכת.",
    }


def build_manager_context(db: Session, *, user: User) -> dict[str, Any]:
    """Operational snapshot for the manager — no fee figures, no gossip."""
    today = date.today()
    name = user.investor.name if getattr(user, "investor", None) else user.username
    own_id = user.investor_id
    own = build_investor_context(db, investor_id=own_id) if own_id else {}

    awaiting = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.status == "awaiting_confirmation")
        .order_by(Payment.due_date.asc())
        .limit(8)
        .all()
    )
    awaiting_count = (
        db.query(Payment).filter(Payment.status == "awaiting_confirmation").count()
    )
    overdue = (
        db.query(Payment)
        .filter(
            Payment.status.in_(("scheduled", "awaiting_confirmation")),
            Payment.due_date < today,
        )
        .count()
    )
    pending_topups = (
        db.query(InvestmentTopupRequest)
        .filter(InvestmentTopupRequest.status.in_(("pending", "contract")))
        .count()
    )
    pending_quotes = (
        db.query(Quote).filter(Quote.status.in_(("pending", "approved"))).count()
    )

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
        tips.append("אפשר לפתוח הצעה חדשה כשמתאים להרחיב תיק — בלי לחץ, לפי שיחה עם הלקוח.")

    return {
        "role": "manager",
        "investor_name": name,
        "active_principal": own.get("active_principal", 0),
        "monthly_cash": own.get("monthly_cash", 0),
        "monthly_savings": own.get("monthly_savings", 0),
        "monthly_total": own.get("monthly_total", 0),
        "current_savings_balance": own.get("current_savings_balance", 0),
        "lifetime_cash_paid": own.get("lifetime_cash_paid", 0),
        "plans": own.get("plans") or [],
        "has_active_plan": own.get("has_active_plan", False),
        "next_payment": own.get("next_payment"),
        "awaiting_confirmations": [_payment_brief(p, include_name=True) for p in awaiting],
        "awaiting_count": awaiting_count,
        "overdue_open_count": overdue,
        "pending_topup_count": pending_topups,
        "pending_quote_count": pending_quotes,
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
            {"label": "הצעה חדשה", "message": "איך פותחים הצעה או מסלול חדש?"},
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
    if context.get("role") == "manager":
        greeting = (
            f"שלום {name}.\n"
            f"{tip}\n"
            "אפשר לשאול על ממתינים לאישור, העברות שעבר מועדן, או לפתוח הצעה חדשה."
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


def system_prompt(investor_name: str, *, role: str = "investor") -> str:
    if role == "manager":
        audience = (
            f"אתה העוזר האישי השקט של המנהל {investor_name} במערכת «תזרים». "
            "עזור בניהול תפעולי: אישורי תשלום ממתינים, העברות שעבר מועדן, בקשות מסלול והצעות. "
            "מותר להזכיר שמות משקיעים רק בהקשר תפעולי קצר (מי ממתין לאישור, מי ביקש תוספת)."
        )
        cta_line = (
            "כשמתאים, הצע בעדינות לפתוח הצעה חדשה או לטפל בבקשת מסלול — "
            "בלי לחץ ובלי הבטחות. הפנה ל«הצעות» או ל«משקיעים»."
        )
    else:
        audience = (
            f"אתה העוזר האישי השקט של המשקיע {investor_name} במערכת «תזרים». "
            "מדברים רק על התיק של {investor_name}."
        )
        cta_line = (
            "כשמתאים לשיחה (שואלים על עוד כסף, מסלול חדש, תוספת, או אחרי סיכום רגוע), "
            "אפשר להציע בעדינות לבקש תוספת / מסלול נוסף בעמוד המשקיעים. "
            "בלי לחץ, בלי «חייבים», בלי הבטחת תשואה."
        )
    return f"""{audience}
סגנון: private-banking lite. עברית קצרה, מדויקת, בלשון פנייה מכבדת. בלי אימוג׳י. בלי סיסמאות שיווקיות.

כללי חובה:
1. אל תמציא מספרים. השתמש רק בנתונים שסופקו בהקשר.
2. אסור להזכיר דמי ניהול, עמלות, או כמה המנהל לוקח.
3. אסור לבצע שינויים במערכת. מותר להסביר ולהפנות למסך הקיים.
4. אם שואלים על עמלה — סרב בנימוס והפנה למנהל בלי מספרים.
5. אם מבקשים «מה אם אוסיף X» — השתמש ב־what_if שסופק והפרד מזומן מחיסכון.
6. {cta_line}
7. הפרד תמיד בין החזר חודשי (מזומן) לבין צבירת חיסכון.
8. טיפ אחד לכל היותר, ורק אם הוא נובע מהמצב בהקשר (אישור ממתין, חודש חדש, מסלול לא פעיל).
9. אם כבר נמסר סיכום תיק בהיסטוריה — אל תחזור עליו. ענה רק לשאלה החדשה."""


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


def _call_gemini(api_key: str, system: str, messages: list[dict], context: dict) -> str:
    # Build Gemini contents from history
    contents = []
    for m in messages[-16:]:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})

    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": contents
        + [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "הקשר תיק (JSON, לשימוש פנימי בלבד):\n"
                            + json.dumps(context, ensure_ascii=False)
                            + "\n\nענה לשאלה האחרונה של המשתמש לפי הכללים."
                        )
                    }
                ],
            }
        ],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1024},
    }
    last_error: Optional[Exception] = None
    with httpx.Client(timeout=45.0) as client:
        for model in _GEMINI_MODELS:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={api_key}"
            )
            res = client.post(url, json=payload)
            if res.status_code >= 400:
                last_error = RuntimeError(
                    _friendly_model_error(res.status_code, res.text)
                )
                # Quota / not-found → try next model; auth errors stop immediately.
                if res.status_code in {401, 403}:
                    raise last_error
                continue
            data = res.json()
            try:
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
            except (KeyError, IndexError, TypeError) as exc:
                raise RuntimeError("תשובת המודל לא תקינה") from exc
    if last_error:
        raise last_error
    raise RuntimeError("המודל לא היה זמין כרגע. נסה שוב בעוד רגע.")


def _call_openai(api_key: str, system: str, messages: list[dict], context: dict) -> str:
    payload = {
        "model": "gpt-4o-mini",
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "system",
                "content": "הקשר תיק JSON:\n" + json.dumps(context, ensure_ascii=False),
            },
            *[
                {"role": m["role"], "content": m["content"]}
                for m in messages[-16:]
                if m["role"] in {"user", "assistant"}
            ],
        ],
    }
    with httpx.Client(timeout=45.0) as client:
        res = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
        if res.status_code >= 400:
            raise RuntimeError(_friendly_model_error(res.status_code, res.text))
        data = res.json()
    return data["choices"][0]["message"]["content"].strip()


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


def wants_pdf(text: str) -> bool:
    return bool(
        re.search(r"\bpdf\b|פי.?די.?אף|הורד(ה|ת)?\s*סיכום|סיכום\s*(ל)?הורדה", text, re.I)
    )


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
    if re.search(r"מה\s+המצב\s+בלוח|תשומת\s+לב|מה\s+דורש", t):
        return "ops"
    if wants_pdf(t) or re.search(
        r"סיכום|מה\s+המצב|התיק\s+שלי|תסביר|מה\s+יש\s+לי", t
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
    if _intent(message) in {"add_capital", "status", "ops", "default", "tip"}:
        return True
    if not context.get("has_active_plan"):
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

    if (
        not manager
        and asks_about_others(message)
        and not re.search(r"התיק\s+שלי|שלי\s+|אצלי|עבורי", message)
        and re.search(r"של\s+(בר|אופק|אלמוג|שושי)|משקיע(ים)?\s+אחר", message)
    ):
        return {
            "reply": "אני יכול לעזור רק לגבי התיק שלך — לא לגבי משקיעים אחרים.",
            "pdf_suggested": False,
            "what_if": None,
            "configured": True,
            "cta": _investor_cta(),
            "suggestions": [],
        }

    context = build_assistant_context(db, user=user)
    what_if = None
    amount = detect_what_if_amount(message)
    if amount is not None:
        what_if = what_if_add_principal(context, amount)
        context = {**context, "what_if_calculation": what_if}

    settings = _settings(db)
    provider, api_key = _llm_credentials(settings)
    attach_cta = _wants_capital_cta(message, context)

    if not api_key:
        reply = _local_reply(context, message, what_if, history=history)
        return {
            "reply": scrub_assistant_text(reply),
            "pdf_suggested": wants_pdf(message),
            "what_if": what_if,
            "configured": False,
            "cta": context.get("cta") if attach_cta else None,
            "suggestions": _suggestions_for(context),
        }

    msgs = [{"role": h["role"], "content": h["content"]} for h in history]
    msgs.append({"role": "user", "content": message})
    system = system_prompt(context["investor_name"], role=context.get("role") or "investor")

    try:
        if provider == "openai":
            raw = _call_openai(api_key, system, msgs, context)
        else:
            raw = _call_gemini(api_key, system, msgs, context)
    except Exception as exc:
        raw = _local_reply(context, message, what_if, history=history)
        note = str(exc).strip() or "המודל לא היה זמין כרגע."
        if len(note) > 160 or "{" in note:
            note = "המודל לא היה זמין כרגע. נסה שוב בעוד רגע."
        raw += f"\n\n({note})"

    return {
        "reply": scrub_assistant_text(raw),
        "pdf_suggested": wants_pdf(message),
        "what_if": what_if,
        "configured": True,
        "cta": context.get("cta") if attach_cta else None,
        "suggestions": _suggestions_for(context),
    }


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

    if what_if and what_if.get("ok"):
        return (
            f"{name}, לפי החישוב על התיק:\n"
            f"קרן היום {_money(context.get('active_principal'))} · "
            f"אחרי תוספת {_money(what_if['extra'])} תהיה {_money(what_if['principal_after'])}.\n"
            f"החזר חודשי במזומן: {_money(what_if['monthly_cash_now'])} → {_money(what_if['monthly_cash_after'])}.\n"
            f"צבירת חיסכון חודשית: {_money(what_if['monthly_savings_now'])} → {_money(what_if['monthly_savings_after'])}.\n"
            "זו הערכה לפי התנאים הנוכחיים — לא שיניתי כלום במערכת. "
            f"אם מתאים, אפשר {cta.get('label', 'לבקש תוספת')}."
        )
    if what_if and not what_if.get("ok"):
        return (
            f"{what_if.get('detail') or 'אין מסלול פעיל לחישוב.'} "
            f"אפשר {cta.get('label', 'לפתוח מסלול')} כשיתאים."
        )

    intent = _intent(message)
    if role != "manager" and intent == "ops":
        intent = "status"

    if role == "manager" and intent in {"ops", "default", "awaiting", "tip"}:
        if intent in {"ops", "default"} and _history_has_markers(
            history, ("זה מה שעומד עכשיו", "ממתינים לאישור:")
        ):
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

    if role == "manager" and intent == "add_capital":
        return (
            "אפשר לפתוח הצעה חדשה בעמוד ההצעות, או לטפל בבקשת מסלול בעמוד המשקיעים. "
            "בלי לחץ — לפי השיחה עם הלקוח."
        )

    if intent == "next_payment":
        if not next_pay:
            return f"{name}, אין כרגע תשלום פתוח בלוח. אם מתאים להרחיב את הקרן — אפשר {cta.get('label', 'לבקש מסלול')}."
        status = "ממתין לאישור קבלה" if next_pay.get("status") == "awaiting_confirmation" else "מתוכנן"
        return (
            f"התשלום הבא: {next_pay.get('month_label') or next_pay.get('due_date')} "
            f"· {_money(next_pay.get('amount'))} · {status}."
        )

    if intent == "paid":
        return (
            f"עד עכשיו שולם במזומן {_money(context.get('lifetime_cash_paid'))}. "
            f"החזר חודשי נוכחי {_money(context.get('monthly_cash'))}, "
            f"וצבירת חיסכון חודשית {_money(context.get('monthly_savings'))}."
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
            "אפשר גם לשאול «מה אם אוסיף 10000» כדי לראות הערכה לפי האחוזים החוזיים במסלול. "
            f"{cta.get('label', 'לבקש תוספת או מסלול')}."
        )

    if intent == "tip":
        return tips[0] if tips else "אם מתאים, אפשר לעבור על התשלום הבא או לשקול תוספת לקרן."

    # status / default — never dump the same snapshot twice in a row.
    if intent == "default" and _history_has_markers(
        history, ("זה המצב בתיק", "קרן פעילה")
    ):
        return (
            "הסיכום כבר למעלה. אפשר לפרט: תשלום הבא, כמה שולם, "
            "אישור ממתין, או הוספת השקעה."
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
    if intent == "status":
        lines.append("אפשר גם להוריד סיכום ב־PDF, או לבקש תוספת אם מתאים.")
    return "\n".join(lines)


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
