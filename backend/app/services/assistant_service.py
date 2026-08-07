"""Personal assistant — read-only, investor-scoped, AI-backed Q&A."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session, joinedload

from app.models.auth import User
from app.models.investments import AppSettings, InvestmentPlan, Investor, Payment
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


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _settings(db: Session) -> AppSettings:
    return inv_svc.ensure_settings(db)


def assistant_configured(db: Session) -> bool:
    settings = _settings(db)
    key = (getattr(settings, "assistant_api_key", None) or "").strip()
    return bool(key)


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
    return {
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
        "plans": plans_out,
        # Explicit denial list for the model
        "privacy": {
            "may_discuss_other_investors": False,
            "may_discuss_managers": False,
            "may_discuss_fees": False,
            "may_change_system": False,
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


def scrub_assistant_text(text: str) -> str:
    """Hard safety net: never leak fee talk even if the model slips."""
    if not text:
        return text
    if FEE_PATTERNS.search(text):
        # Replace whole reply if fee content appears.
        return FORBIDDEN_REPLY
    # Soft redactionsact common fee words if somehow embedded.
    cleaned = re.sub(
        r"(דמי\s*ניהול|עמלת?\s*ניהול|עמלת?\s*מנהל)[^.!\n]*[.!]?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return cleaned.strip() or FORBIDDEN_REPLY


def system_prompt(investor_name: str) -> str:
    return f"""אתה עוזר אישי של המשקיע {investor_name} במערכת «תזרים».
דבר בעברית ברורה, חמה ומקצועית, בלשון זכר. אל תציג את עצמך כבינה מלאכותית או כבוט — אתה «עוזר אישי».

כללי חובה:
1. מדברים רק על התיק של {investor_name}. אסור מידע על משקיעים אחרים או על מנהלים.
2. אסור בכלל להזכיר דמי ניהול, עמלות, כמה המנהל לוקח, או אחוזי עמלה.
3. אסור לבצע או להציע שינויים במערכת. רק הסברים וחישובים.
4. אם שואלים על עמלה/דמי ניהול — סרב בנימוס והפנה למנהל בלי מספרים.
5. אם מבקשים «מה אם אוסיף X» — השתמש בנתוני החישוב שסופקו (what_if) והסבר במזומן ובחיסכון בנפרד.
6. אם מבקשים סיכום להורדה — ציין שניתן להפיק PDF ואסוף את עיקרי הדברים.
7. אל תמציא מספרים. השתמש רק בנתונים שסופקו בהקשר.

סגנון: קצר, ברור, עם מספרים ב־₪ כשיש. הפרד תמיד בין החזר חודשי (מזומן) לבין צבירת חיסכון."""


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

    if asks_about_fees(message):
        return {
            "reply": FORBIDDEN_REPLY,
            "pdf_suggested": False,
            "what_if": None,
            "configured": True,
        }

    if asks_about_others(message) and not re.search(
        r"התיק\s+שלי|שלי\s+|אצלי|עבורי", message
    ):
        # Allow "שלי" questions; block asking about named others.
        if re.search(r"של\s+(בר|אופק|אלמוג|שושי)|משקיע(ים)?\s+אחר", message):
            return {
                "reply": "אני יכול לעזור רק לגבי התיק שלך — לא לגבי משקיעים אחרים.",
                "pdf_suggested": False,
                "what_if": None,
                "configured": True,
            }

    context = build_investor_context(db, investor_id=investor_id)
    what_if = None
    amount = detect_what_if_amount(message)
    if amount is not None:
        what_if = what_if_add_principal(context, amount)
        context = {**context, "what_if_calculation": what_if}

    settings = _settings(db)
    api_key = (getattr(settings, "assistant_api_key", None) or "").strip()
    provider = (getattr(settings, "assistant_provider", None) or "gemini").strip().lower()

    if not api_key:
        # Deterministic fallback from live numbers (no canned FAQ).
        reply = _local_reply(context, message, what_if)
        return {
            "reply": scrub_assistant_text(reply),
            "pdf_suggested": wants_pdf(message),
            "what_if": what_if,
            "configured": False,
        }

    msgs = [{"role": h["role"], "content": h["content"]} for h in history]
    msgs.append({"role": "user", "content": message})
    system = system_prompt(context["investor_name"])

    try:
        if provider == "openai":
            raw = _call_openai(api_key, system, msgs, context)
        else:
            raw = _call_gemini(api_key, system, msgs, context)
    except Exception as exc:
        # Fall back to calculation-aware local reply — keep the note short.
        raw = _local_reply(context, message, what_if)
        note = str(exc).strip() or "המודל לא היה זמין כרגע."
        if len(note) > 160 or "{" in note:
            note = "המודל לא היה זמין כרגע. נסה שוב בעוד רגע."
        raw += f"\n\n({note})"

    return {
        "reply": scrub_assistant_text(raw),
        "pdf_suggested": wants_pdf(message),
        "what_if": what_if,
        "configured": True,
    }


def _local_reply(context: dict, message: str, what_if: Optional[dict]) -> str:
    """Live-data reply when LLM key is missing — numbers only from this portfolio."""
    name = context["investor_name"]
    if what_if and what_if.get("ok"):
        return (
            f"{name}, לפי החישוב על התיק שלך:\n"
            f"· קרן היום: ₪{context['active_principal']:,.2f}\n"
            f"· אחרי תוספת ₪{what_if['extra']:,.2f}: קרן ₪{what_if['principal_after']:,.2f}\n"
            f"· החזר חודשי (מזומן): ₪{what_if['monthly_cash_now']:,.2f} → ₪{what_if['monthly_cash_after']:,.2f}\n"
            f"· צבירת חיסכון חודשית: ₪{what_if['monthly_savings_now']:,.2f} → ₪{what_if['monthly_savings_after']:,.2f}\n"
            f"· סה״כ חודשי אחרי התוספת: ₪{what_if['monthly_total_after']:,.2f}\n"
            f"החישוב הוא הערכה לפי האחוזים במסלול שלך — לא שיניתי כלום במערכת."
        )

    if wants_pdf(message) or re.search(r"סיכום|מה\s+יש\s+לי|התיק\s+שלי|תסביר", message):
        plans = context.get("plans") or []
        active = [p for p in plans if p.get("status") == "active"]
        lines = [
            f"היי {name}, זה הסיכום של התיק שלך:",
            f"· קרן פעילה: ₪{context['active_principal']:,.2f}",
            f"· החזר חודשי (מזומן): ₪{context['monthly_cash']:,.2f}",
            f"· צבירת חיסכון חודשית: ₪{context['monthly_savings']:,.2f}",
            f"· יתרת חיסכון עד עכשיו: ₪{context['current_savings_balance']:,.2f}",
            f"· שולם במזומן עד היום: ₪{context['lifetime_cash_paid']:,.2f}",
        ]
        for p in active:
            lines.append(
                f"· מסלול #{p['plan_id']} ({p['plan_type']}): קרן ₪{p['principal']:,.2f}, "
                f"מזומן {p['cash_rate_percent']}% / חיסכון {p['savings_rate_percent']}%, "
                f"התקדמות {p['months_elapsed']}/{p['duration_months']}"
            )
        lines.append("אם תרצה, אפשר גם להוריד את זה כ־PDF או לחשב «מה אם אוסיף סכום».")
        return "\n".join(lines)

    return (
        f"היי {name}. אני העוזר האישי שלך לתיק.\n"
        f"כרגע: קרן ₪{context['active_principal']:,.2f}, "
        f"מזומן חודשי ₪{context['monthly_cash']:,.2f}, "
        f"חיסכון חודשי ₪{context['monthly_savings']:,.2f}, "
        f"יתרת חיסכון ₪{context['current_savings_balance']:,.2f}.\n"
        "אפשר לשאול אותי על התיק, לבקש סיכום/PDF, או לחשב מה קורה אם מוסיפים סכום."
    )


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
