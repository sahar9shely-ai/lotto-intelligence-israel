"""Live-data retrieval for the personal assistant — names, snapshots, tools."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy.orm import Session, joinedload

from app.models.auth import User
from app.models.investments import (
    InvestmentPlan,
    InvestmentTopupRequest,
    Investor,
    Payment,
    Quote,
)
from app.services import investment_service as inv_svc


# Question filler — stripped before name matching so «השקיעה» / «כמה כסף» never hide a name.
_QUERY_STOP = frozenset(
    {
        "hello",
        "hey",
        "hi",
        "ok",
        "okay",
        "אצל",
        "איך",
        "אין",
        "אישור",
        "היי",
        "הי",
        "הלו",
        "שלום",
        "בוקר",
        "ערב",
        "מנהל",
        "מנהלת",
        "מערכת",
        "עוזר",
        "אישי",
        "אפשר",
        "את",
        "בדוק",
        "בלוח",
        "במערכת",
        "בתיק",
        "גם",
        "האם",
        "ההעברה",
        "החזר",
        "החודש",
        "היום",
        "היכן",
        "המצב",
        "המערכת",
        "המשקיע",
        "הצעה",
        "הצעות",
        "הקרן",
        "התיק",
        "ו",
        "זה",
        "חודש",
        "חסר",
        "חסרה",
        "חסרים",
        "כמה",
        "כן",
        "כסף",
        "לא",
        "לב",
        "לה",
        "לו",
        "לי",
        "לשלם",
        "מה",
        "מי",
        "ממתין",
        "ממתינה",
        "ממתינים",
        "מצב",
        "משקיע",
        "משקיעה",
        "משקיעים",
        "מסלול",
        "מסלולים",
        "נתונים",
        "סהכ",
        "סה״כ",
        "סהך",
        "סטטוס",
        "סיכום",
        "עד",
        "עכשיו",
        "על",
        "עבור",
        "פעילות",
        "פרטי",
        "תיק",
        "תשלום",
        "תשלומים",
        "תגיד",
        "תראה",
        "תראי",
        "של",
        "שלה",
        "שלו",
        "שלהם",
        "שלי",
        "יתרה",
        "יתרות",
        "קרן",
        "חדשה",
        "חדש",
        "דורש",
        "תשומת",
        "בכל",
        "בכול",
        "יש",
        "להשקיע",
        "השקיע",
        "השקיעה",
        "השקיעו",
        "הפקיד",
        "הפקידה",
        "הפקידו",
        "הכניס",
        "הכניסה",
        "הכניסו",
        "שילם",
        "שילמה",
        "שילמו",
        "קיבל",
        "קיבלה",
        "קיבלו",
        "נכון",
        "תן",
        "תני",
        "תנו",
        "ספר",
        "ספרי",
        "תרשום",
        "נא",
        "בבקשה",
        "הראה",
        "הראי",
        "עבור",
        "תודה",
        "אגב",
        "רק",
        "עוד",
        "כל",
        "כולם",
        "כולן",
        "אצלך",
        "אצלי",
        "במסך",
        "מסך",
        "נמצא",
        "נמצאת",
        "פעיל",
        "פעילה",
        "פעילים",
    }
)

_GENDERED_VERB_RE = re.compile(
    r"השק[יי]ע[הותםן]?|הפקיד[הותםן]?|הכניס[הותםן]?|"
    r"שיל[מם][הותםן]?|קיבל[הותםן]?|הוסי[ףפ][הותםן]?|"
    r"פתח[הותםן]?|חסר[הותםן]?",
    re.UNICODE,
)

_PREFIXES = ("ל",)

_HE_WORD_RE = re.compile(r"[A-Za-z0-9\u0590-\u05FF״\"']{2,}")


def json_safe(value: Any) -> Any:
    """JSON-serializable copy (dates → ISO)."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, float):
        return round(value, 2)
    return value


def _strip_prefix(token: str) -> str:
    """Only the ל clitic («לאופק», «לבר») — never eat the first letter of a surname."""
    for prefix in _PREFIXES:
        if token.startswith(prefix) and len(token) > len(prefix) + 1:
            rest = token[len(prefix) :]
            if rest not in _QUERY_STOP:
                return rest
    return token


def extract_name_query(message: str) -> str:
    """Pull a likely person name out of a Hebrew question, ignoring verbs/gender."""
    text = _GENDERED_VERB_RE.sub(" ", message or "")
    text = re.sub(r"[?!,.:;()\[\]{}]+", " ", text)
    tokens: list[str] = []
    for raw in _HE_WORD_RE.findall(text):
        token = raw.strip("\"'«»״")
        if not token or token in _QUERY_STOP or token.isdigit():
            continue
        token = _strip_prefix(token)
        if not token or token in _QUERY_STOP or token.isdigit():
            continue
        tokens.append(token)
    # Drop leftover short noise.
    tokens = [t for t in tokens if t not in _QUERY_STOP]
    return " ".join(tokens).strip()


def _name_tokens(name: str) -> list[str]:
    return [t for t in re.split(r"\s+", (name or "").strip()) if t]


def score_name_match(query: str, investor_name: str, username: str = "") -> int:
    q = (query or "").strip()
    name = (investor_name or "").strip()
    if not q or not name:
        return 0
    q_l = q.lower()
    n_l = name.lower()
    u_l = (username or "").strip().lower()
    if q_l == n_l or (u_l and q_l == u_l):
        return 100
    if n_l.startswith(q_l) or q_l.startswith(n_l):
        return 92
    if n_l in q_l or q_l in n_l:
        return 88
    q_tokens = [t.lower() for t in _name_tokens(q)]
    n_tokens = [t.lower() for t in _name_tokens(name)]
    if not q_tokens or not n_tokens:
        return 0
    if n_tokens[0] == q_tokens[0]:
        return 84
    overlap = set(q_tokens) & set(n_tokens)
    if overlap:
        return 70 + min(14, 4 * len(overlap))
    if u_l and (q_l in u_l or u_l in q_l):
        return 65
    return 0


def list_book_investors(db: Session) -> list[Investor]:
    rows = (
        db.query(Investor)
        .options(
            joinedload(Investor.plans).joinedload(InvestmentPlan.payments),
            joinedload(Investor.user),
        )
        .order_by(Investor.id)
        .all()
    )
    return [row for row in rows if not inv_svc.is_admin_shell(row)]


def find_investors_by_query(
    db: Session, query: str, *, limit: int = 5
) -> list[tuple[Investor, int]]:
    needle = (query or "").strip()
    if not needle:
        return []
    scored: list[tuple[Investor, int]] = []
    for investor in list_book_investors(db):
        username = ""
        user = getattr(investor, "user", None)
        if user is not None:
            username = getattr(user, "username", "") or ""
        score = score_name_match(needle, investor.name, username)
        if score <= 0:
            continue
        scored.append((investor, score))
    scored.sort(key=lambda item: (-item[1], item[0].name))
    return scored[:limit]


def investor_public_brief(investor: Investor, today: Optional[date] = None) -> dict[str, Any]:
    """Numbers an assistant may quote — never fees, passwords, or contact secrets."""
    summary = inv_svc.serialize_investor(investor, today or date.today())
    user = getattr(investor, "user", None)
    has_password = bool(user and user.password_hash)
    must_reset = bool(user and user.must_reset_password)
    return {
        "id": summary["id"],
        "name": summary["name"],
        "active_principal": summary["active_principal"],
        "monthly_cash": summary["monthly_cash"],
        "monthly_savings": summary["monthly_savings"],
        "monthly_total": summary["monthly_total"],
        "current_savings_balance": summary["current_savings_balance"],
        "projected_savings_balance": summary["projected_savings_balance"],
        "active_plans_count": summary["active_plans_count"],
        "plan_types": summary["plan_types"],
        "months_in_program": summary["months_in_program"],
        "has_login": summary["has_login"],
        "has_password": has_password,
        "must_reset_password": must_reset,
        "status": "active" if summary["active_plans_count"] else "inactive",
    }


def documents_brief(db: Session, *, investor: Investor) -> list[dict[str, Any]]:
    vault = inv_svc.list_document_vault(db, investor=investor)
    out = []
    for row in (vault.get("documents") or [])[:24]:
        out.append(
            {
                "kind": row.get("kind"),
                "title": row.get("title"),
                "subtitle": row.get("subtitle"),
                "period": row.get("period"),
            }
        )
    return out


def _payment_row(payment: Payment) -> dict[str, Any]:
    due = payment.due_date
    return {
        "id": payment.id,
        "investor_id": payment.investor_id,
        "investor_name": payment.investor.name if payment.investor else "",
        "due_date": due.isoformat() if due else None,
        "month_key": due.strftime("%Y-%m") if due else None,
        "month_label": (
            ("", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר")[
                due.month
            ]
            if due
            else ""
        ),
        "amount": float(payment.investor_amount or 0),
        "status": payment.status,
    }


def month_payment_ops(db: Session, *, today: Optional[date] = None) -> dict[str, Any]:
    """Unpaid this month + overdue — same idea as the dashboard «דחוף עכשיו» board."""
    today = today or date.today()
    month_key = today.strftime("%Y-%m")
    open_pays = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.status.in_(("scheduled", "awaiting_confirmation")))
        .order_by(Payment.due_date.asc(), Payment.id.asc())
        .all()
    )
    missing: list[dict[str, Any]] = []
    overdue: list[dict[str, Any]] = []
    this_month_total = 0.0
    awaiting: list[dict[str, Any]] = []
    for payment in open_pays:
        if inv_svc.is_admin_shell(payment.investor):
            continue
        if float(payment.investor_amount or 0) <= 0:
            continue
        row = _payment_row(payment)
        if payment.status == "awaiting_confirmation":
            awaiting.append(row)
        due = payment.due_date
        if not due:
            continue
        key = due.strftime("%Y-%m")
        if key == month_key:
            missing.append(row)
            this_month_total += float(payment.investor_amount or 0)
        elif key < month_key:
            overdue.append(row)

    def _merge(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_id: dict[int, dict[str, Any]] = {}
        for row in rows:
            iid = int(row["investor_id"])
            prev = by_id.get(iid)
            if not prev:
                by_id[iid] = dict(row)
                continue
            prev["amount"] = round(float(prev["amount"]) + float(row["amount"]), 2)
            if prev.get("status") == "awaiting_confirmation" and row.get("status") == "scheduled":
                prev["status"] = "scheduled"
                prev["due_date"] = row.get("due_date")
                prev["month_key"] = row.get("month_key")
        return sorted(by_id.values(), key=lambda item: item.get("investor_name") or "")

    return {
        "month_key": month_key,
        "this_month_to_pay": round(this_month_total, 2),
        "this_month_to_pay_count": len({r["investor_id"] for r in missing}),
        "missing_this_month": _merge(missing),
        "overdue": _merge(overdue),
        "awaiting_confirmations": awaiting[:20],
        "awaiting_count": len(awaiting),
        "overdue_count": len(overdue),
    }


def quotes_brief(db: Session) -> dict[str, Any]:
    quotes = db.query(Quote).order_by(Quote.id.desc()).all()
    by_status: dict[str, int] = defaultdict(int)
    rows = []
    for quote in quotes:
        status = inv_svc.normalize_quote_status(quote.status)
        by_status[status] += 1
        rows.append(
            {
                "id": quote.id,
                "prospect_name": quote.prospect_name,
                "principal": float(quote.principal or 0),
                "status": status,
                "duration_months": quote.duration_months,
            }
        )
    return {
        "counts": dict(by_status),
        "pending_count": int(by_status.get("pending") or 0),
        "approved_count": int(by_status.get("approved") or 0),
        "converted_count": int(by_status.get("converted") or 0),
        "rejected_count": int(by_status.get("rejected") or 0),
        "quotes": rows[:24],
    }


def topups_brief(db: Session) -> list[dict[str, Any]]:
    rows = (
        db.query(InvestmentTopupRequest)
        .options(joinedload(InvestmentTopupRequest.investor))
        .filter(InvestmentTopupRequest.status.in_(("pending", "contract")))
        .order_by(InvestmentTopupRequest.created_at.desc())
        .limit(16)
        .all()
    )
    out = []
    for row in rows:
        out.append(
            {
                "id": row.id,
                "investor_id": row.investor_id,
                "investor_name": row.investor.name if row.investor else "",
                "amount": float(row.amount or 0),
                "status": row.status,
            }
        )
    return out


def users_password_brief(db: Session) -> dict[str, Any]:
    users = (
        db.query(User)
        .options(joinedload(User.investor))
        .order_by(User.id)
        .all()
    )
    without: list[dict[str, Any]] = []
    must_reset: list[dict[str, Any]] = []
    for user in users:
        investor = user.investor
        if inv_svc.is_admin_shell(investor):
            continue
        item = {
            "username": user.username,
            "investor_name": investor.name if investor else "",
            "has_password": bool(user.password_hash),
            "must_reset_password": bool(user.must_reset_password),
        }
        if not user.password_hash:
            without.append(item)
        elif user.must_reset_password:
            must_reset.append(item)
    return {
        "without_password": without,
        "must_reset_password": must_reset,
        "without_password_count": len(without),
        "must_reset_count": len(must_reset),
    }


def system_snapshot(db: Session) -> dict[str, Any]:
    """Full ops snapshot for ADMIN — every book investor, no admin shell, no fees."""
    today = date.today()
    dash = inv_svc.get_dashboard(db)
    investors = [investor_public_brief(row, today) for row in list_book_investors(db)]
    ops = month_payment_ops(db, today=today)
    quotes = quotes_brief(db)
    users = users_password_brief(db)
    topups = topups_brief(db)
    return json_safe(
        {
            "totals": {
                "total_principal": dash["total_principal"],
                "monthly_cash_payouts": dash["monthly_cash_payouts"],
                "monthly_savings_accruals": dash["monthly_savings_accruals"],
                "monthly_investor_total": dash["monthly_investor_total"],
                "current_savings_total": dash["current_savings_total"],
                "lifetime_investor_paid": dash["lifetime_investor_paid"],
                "ytd_investor_paid": dash["ytd_investor_paid"],
                "active_investors": dash["active_investors"],
                "active_plans": dash["active_plans"],
                "investor_count": len(investors),
                "this_month_to_pay": ops["this_month_to_pay"],
                "this_month_to_pay_count": ops["this_month_to_pay_count"],
            },
            "investors": investors,
            "missing_this_month": ops["missing_this_month"],
            "overdue": ops["overdue"],
            "awaiting_confirmations": ops["awaiting_confirmations"],
            "awaiting_count": ops["awaiting_count"],
            "overdue_open_count": ops["overdue_count"],
            "pending_topup_count": len(topups),
            "pending_topups": topups,
            "quotes": quotes,
            "pending_quote_count": quotes["pending_count"] + quotes["approved_count"],
            "users_without_password": users["without_password"],
            "users_must_reset_password": users["must_reset_password"],
            "users_without_password_count": users["without_password_count"],
        }
    )


def payments_for_investor(
    db: Session, *, investor_id: int, limit: int = 16
) -> dict[str, Any]:
    open_pays = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(
            Payment.investor_id == investor_id,
            Payment.status.in_(("scheduled", "awaiting_confirmation")),
        )
        .order_by(Payment.due_date.asc())
        .limit(limit)
        .all()
    )
    recent = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.investor_id == investor_id, Payment.status == "paid")
        .order_by(Payment.paid_at.desc(), Payment.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "open": [_payment_row(p) for p in open_pays],
        "recent_paid": [_payment_row(p) for p in recent],
    }


def looks_like_person_lookup(message: str, name_query: str) -> bool:
    if not name_query:
        return False
    tokens = [t for t in name_query.split() if t]
    if len(tokens) >= 2:
        return True
    if re.search(
        r"השק[יי]ע|הפקיד|הכניס|תיק\s+של|כמה\s+(כסף|יש)|קרן\s+של|סטטוס\s+של",
        message or "",
    ):
        return True
    first = re.escape(tokens[0])
    if re.search(rf"(?:של|ל|אצל)\s+{first}|{first}\s+(?:השק|הפקיד|בתיק)", message or ""):
        return True
    return False


def retrieve_named_investors(
    db: Session,
    *,
    message: str,
    build_portfolio,
    limit: int = 3,
) -> dict[str, Any]:
    """Resolve «בר מוסרי השקיעה» → live investor row + portfolio numbers."""
    name_query = extract_name_query(message)
    if not name_query:
        return {}
    matches = find_investors_by_query(db, name_query, limit=limit)
    if not matches and not looks_like_person_lookup(message, name_query):
        return {}
    retrieved = []
    for investor, score in matches:
        brief = investor_public_brief(investor)
        portfolio = build_portfolio(db, investor_id=investor.id)
        retrieved.append(
            {
                "matched_as": investor.name,
                "match_score": score,
                "query": name_query,
                **brief,
                "portfolio": {
                    "active_principal": portfolio.get("active_principal"),
                    "monthly_cash": portfolio.get("monthly_cash"),
                    "monthly_savings": portfolio.get("monthly_savings"),
                    "monthly_total": portfolio.get("monthly_total"),
                    "current_savings_balance": portfolio.get("current_savings_balance"),
                    "lifetime_cash_paid": portfolio.get("lifetime_cash_paid"),
                    "has_active_plan": portfolio.get("has_active_plan"),
                    "plans": portfolio.get("plans") or [],
                    "next_payment": portfolio.get("next_payment"),
                    "awaiting_confirmations": portfolio.get("awaiting_confirmations") or [],
                },
            }
        )
    note = None
    if retrieved:
        first = retrieved[0]
        if first["matched_as"] != name_query:
            note = (
                f"השם «{name_query}» זוהה כמשקיע «{first['matched_as']}» "
                "(חיפוש חלקי / שם פרטי, כולל לשון נקבה כמו «השקיעה»)."
            )
    else:
        note = f"לא נמצא משקיע בשם «{name_query}» במערכת."
    return json_safe(
        {
            "name_query": name_query,
            "retrieved_investors": retrieved,
            "retrieval_note": note,
        }
    )


# ---------------------------------------------------------------------------
# Tool calling (Gemini / OpenAI) — wraps the same live queries the API uses.
# ---------------------------------------------------------------------------

MANAGER_TOOLS: list[dict[str, Any]] = [
    {
        "name": "lookup_investor",
        "description": (
            "איתור משקיע לפי שם מלא, שם פרטי, כינוי או שם משתמש. "
            "עובד גם עם שם משפחה נוסף («בר מוסרי») וגם עם פעלים מגדריים («השקיעה»). "
            "מחזיר קרן, החזר, חיסכון, מסלולים ותשלומים חיים."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "שם לחיפוש, למשל בר מוסרי / אופק / סהר",
                }
            },
            "required": ["name"],
        },
    },
    {
        "name": "system_overview",
        "description": (
            "סיכום מערכת: סה״כ קרן, החזרים, מי ממתין לאישור, מי חסר החודש, "
            "כמה לשלם החודש, הצעות, בקשות מסלול, משתמשים בלי סיסמה."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "list_payments",
        "description": "תשלומים פתוחים / ששולמו. אפשר לסנן לפי שם משקיע.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "שם משקיע אופציונלי"},
                "status": {
                    "type": "string",
                    "description": "scheduled / awaiting_confirmation / paid / open",
                },
            },
        },
    },
    {
        "name": "list_quotes",
        "description": "סטטוס הצעות השקעה במערכת.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "list_users_without_password",
        "description": "משתמשים בלי סיסמה, או שחייבים לאפס סיסמה.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "lookup_documents",
        "description": "מסמכים בתיק (חוזים, הצעות, דוחות) למשקיע לפי שם.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "שם משקיע"},
            },
            "required": ["name"],
        },
    },
]

INVESTOR_TOOLS: list[dict[str, Any]] = [
    {
        "name": "lookup_own_portfolio",
        "description": "התיק של המשקיע המחובר בלבד — קרן, החזר, חיסכון, מסלולים.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "lookup_own_payments",
        "description": "תשלומים של המשקיע המחובר בלבד.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "lookup_own_documents",
        "description": "מסמכים של המשקיע המחובר בלבד.",
        "parameters": {"type": "object", "properties": {}},
    },
]


def tools_for_role(role: str) -> list[dict[str, Any]]:
    return MANAGER_TOOLS if role == "manager" else INVESTOR_TOOLS


def gemini_tool_declarations(role: str) -> list[dict[str, Any]]:
    return [
        {
            "name": spec["name"],
            "description": spec["description"],
            "parameters": spec["parameters"],
        }
        for spec in tools_for_role(role)
    ]


def openai_tools(role: str) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": spec["name"],
                "description": spec["description"],
                "parameters": spec["parameters"]
                if spec["parameters"].get("properties")
                else {"type": "object", "properties": {}},
            },
        }
        for spec in tools_for_role(role)
    ]


def _first_match(db: Session, name: str) -> Optional[Investor]:
    hits = find_investors_by_query(db, name, limit=1)
    return hits[0][0] if hits else None


def execute_tool(
    db: Session,
    *,
    user: User,
    role: str,
    name: str,
    arguments: Optional[dict[str, Any]],
    build_portfolio,
) -> dict[str, Any]:
    args = arguments or {}
    own_id = user.investor_id

    if role != "manager":
        if name == "lookup_own_portfolio":
            if not own_id:
                return {"error": "אין תיק מקושר"}
            portfolio = build_portfolio(db, investor_id=own_id)
            return json_safe(portfolio)
        if name == "lookup_own_payments":
            if not own_id:
                return {"error": "אין תיק מקושר"}
            return json_safe(payments_for_investor(db, investor_id=own_id))
        if name == "lookup_own_documents":
            if not own_id:
                return {"error": "אין תיק מקושר"}
            investor = db.query(Investor).filter(Investor.id == own_id).first()
            if not investor:
                return {"error": "משקיע לא נמצא"}
            return {"documents": documents_brief(db, investor=investor)}
        return {"error": "הכלי אינו זמין למשקיע"}

    if name == "system_overview":
        return system_snapshot(db)
    if name == "list_quotes":
        return quotes_brief(db)
    if name == "list_users_without_password":
        return users_password_brief(db)
    if name == "lookup_investor":
        query = str(args.get("name") or "").strip()
        if not query:
            return {"error": "חסר שם לחיפוש"}
        matches = find_investors_by_query(db, query, limit=5)
        if not matches:
            return {"found": False, "query": query, "error": f"לא נמצא משקיע בשם «{query}»"}
        rows = []
        for investor, score in matches:
            portfolio = build_portfolio(db, investor_id=investor.id)
            rows.append(
                {
                    "matched_as": investor.name,
                    "match_score": score,
                    "query": query,
                    **investor_public_brief(investor),
                    "plans": portfolio.get("plans") or [],
                    "next_payment": portfolio.get("next_payment"),
                    "lifetime_cash_paid": portfolio.get("lifetime_cash_paid"),
                }
            )
        return json_safe({"found": True, "investors": rows})
    if name == "list_payments":
        query = str(args.get("name") or "").strip()
        status = str(args.get("status") or "open").strip().lower()
        investor_id = None
        if query:
            hit = _first_match(db, query)
            if hit is None:
                return {"found": False, "error": f"לא נמצא משקיע בשם «{query}»"}
            investor_id = hit.id
        q = db.query(Payment).options(joinedload(Payment.investor))
        if investor_id:
            q = q.filter(Payment.investor_id == investor_id)
        if status == "paid":
            q = q.filter(Payment.status == "paid")
        elif status == "awaiting_confirmation":
            q = q.filter(Payment.status == "awaiting_confirmation")
        elif status == "scheduled":
            q = q.filter(Payment.status == "scheduled")
        else:
            q = q.filter(Payment.status.in_(("scheduled", "awaiting_confirmation")))
        rows = q.order_by(Payment.due_date.asc()).limit(24).all()
        rows = [p for p in rows if not inv_svc.is_admin_shell(p.investor)]
        return json_safe({"payments": [_payment_row(p) for p in rows]})
    if name == "lookup_documents":
        query = str(args.get("name") or "").strip()
        hit = _first_match(db, query) if query else None
        if hit is None:
            return {"error": f"לא נמצא משקיע בשם «{query}»"}
        return {"investor_name": hit.name, "documents": documents_brief(db, investor=hit)}
    return {"error": f"כלי לא מוכר: {name}"}
