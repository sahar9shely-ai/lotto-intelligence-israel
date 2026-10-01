from __future__ import annotations

import hashlib
import json
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.investments import Investor, InvestmentPlan, PlanAgreement, PlanNotice, AppSettings, utcnow
from app.services import investment_service as svc, wallet_service as wallet
from app.services.israel_business_days import israel_today


def digest(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def end_date(plan: InvestmentPlan) -> date:
    return svc.add_months(plan.start_date, plan.duration_months)


def closing_terms(plan: InvestmentPlan, *, preview: bool = False, include_months: bool = True) -> dict:
    today = israel_today()
    if plan.status != "active" or plan.closed_on:
        raise ValueError("ניתן להכין הסכם סיום רק למסלול פעיל")
    if not preview and today < end_date(plan):
        raise ValueError("אין אפשרות לסגור את המסלול לפני תום התקופה שסוכמה")
    terms = {"principal": wallet.cents(plan.principal) / 100,
            "savings": wallet.cents(svc.available_savings_for_plan(plan, today)) / 100,
            "paid_cash": round(sum(p.investor_amount for p in plan.payments if p.status == "paid"), 2),
            "unpaid_cash": round(sum(p.investor_amount for p in plan.payments if p.status in {"scheduled", "awaiting_confirmation"} and p.due_date <= today), 2),
            "start_date": plan.start_date.isoformat(), "end_date": end_date(plan).isoformat(),
            "duration_months": plan.duration_months, "plan_id": plan.id}
    if include_months:
        terms["savings_months"] = svc.completed_months(plan.start_date, today, cap=svc.plan_effective_duration(plan))
    return terms


CLOSING_CLAUSES = [
    "הצדדים מאשרים את סיום המסלול בתום התקופה שסוכמה, בכפוף לחתימת המשקיע על הסכם זה.",
    "לאחר החתימה תיסגר הצבירה במסלול, והקרן והחיסכון שנותר ייזקפו לחשבון היתרה הזמינה של המשקיע.",
    "החיסכון מחושב על הקרן בלבד, עבור חודשים מלאים ועד תום התקופה, ללא ריבית דריבית.",
    "תשלומי מזומן שכבר שולמו אינם נזקפים שוב. סכומי מזומן שהגיע מועד תשלומם וטרם שולמו נותרים חוב לתשלום; תשלומים עתידיים של המסלול מבוטלים.",
    "הזיכוי בחשבון היתרה הזמינה הוא רישום במערכת ואינו אישור לביצוע העברה בנקאית או לקבלת הכסף בפועל.",
    "היתרה הזמינה אינה צוברת תשואה. השקעתה במסלול נוסף מחייבת הסכם חדש וחתימת המשקיע.",
    "החתימה מאשרת את הנתונים והפעולות המפורטים במסמך זה בלבד ואינה ויתור כללי על זכויות או על חובות שלא נפרעו.",
]


def document_snapshot(db: Session, *, investor: Investor, kind: str, terms: dict, clauses: list[str], requested_on: date) -> dict:
    manager_settings = db.query(AppSettings).first()
    return {"version": 1, "investor_name": investor.name,
            "manager_name": manager_settings.manager_display_name if manager_settings else "המנהל",
            "title": "הסכם סיום מסלול" if kind == "close" else "הסכם פתיחת מסלול",
            "terms": terms, "clauses": clauses + ["בקשה למשיכת כספים, להמשך מסלול או לפתיחת מסלול חדש יש להגיש חודש מראש."],
            "notice_requested_on": requested_on.isoformat()}


def closing_preview(db: Session, plan: InvestmentPlan, requested_on: date) -> dict:
    today = israel_today()
    if requested_on > today:
        raise ValueError("תאריך קבלת הבקשה אינו יכול להיות עתידי")
    terms = closing_terms(plan, preview=True)
    terms["transfer_total"] = round(terms["principal"] + terms["savings"], 2)
    snapshot = document_snapshot(db, investor=plan.investor, kind="close", terms=terms, clauses=CLOSING_CLAUSES, requested_on=requested_on)
    eligible_on = max(end_date(plan), svc.add_months(requested_on, 1))
    return {"kind": "close", "snapshot": snapshot, "document_hash": digest(snapshot),
            "eligible_on": eligible_on, "can_prepare": today >= eligible_on, "calculated_on": today}


def issue(db: Session, *, investor_id: int, kind: str, actor_id: int, notice_id: int, data: dict | None = None, plan_id: int | None = None):
    investor = wallet.lock_investor(db, investor_id)
    notice = db.get(PlanNotice, notice_id)
    if not notice or notice.investor_id != investor_id or notice.purpose not in ({"withdraw", "renew"} if kind == "close" else {"new", "renew"}):
        raise ValueError("יש לבחור בקשה מתועדת מראש התואמת לפעולה ולמשקיע")
    eligible_on = svc.add_months(notice.requested_on, 1)
    if db.query(PlanAgreement).filter(PlanAgreement.investor_id == investor_id, PlanAgreement.status == "pending").first():
        raise ValueError("קיים הסכם הממתין לחתימה. יש להשלים או לבטל אותו לפני הכנת הסכם נוסף")
    if kind == "close":
        plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id, InvestmentPlan.investor_id == investor_id).with_for_update().one_or_none()
        if not plan:
            raise ValueError("המסלול לא נמצא")
        terms = closing_terms(plan)
        if israel_today() < eligible_on:
            raise ValueError("טרם חלף חודש ממועד הבקשה מראש")
        terms["transfer_total"] = round(terms["principal"] + terms["savings"], 2)
        private = {}
        clauses = CLOSING_CLAUSES
    else:
        if not data:
            raise ValueError("חסרים תנאי המסלול")
        private = json.loads(json.dumps(data, default=str))
        balance = (investor.available_balance_cents or 0) / 100
        principal = wallet.cents(data["principal"]) / 100
        additional = wallet.cents(data.get("additional_funds") if data.get("additional_funds") is not None else principal - balance) / 100
        if principal <= 0 or wallet.cents(principal) != wallet.cents(balance) + wallet.cents(additional):
            raise ValueError("הקרן חייבת לכלול את כל היתרה הזמינה ותוספת הכסף")
        kind_name, cash, savings = svc.normalize_plan_rates(data["plan_type"], data["monthly_rate_percent"], data["savings_rate_percent"])
        requested_start = date.fromisoformat(str(data["start_date"]))
        if requested_start < eligible_on:
            raise ValueError("תאריך התחלת המסלול חייב להיות לפחות חודש אחרי מועד הבקשה")
        private.update(additional_funds=additional, plan_type=kind_name, monthly_rate_percent=cash, savings_rate_percent=savings)
        terms = {"principal": principal, "plan_type": kind_name, "available_balance": balance, "additional_funds": additional,
                 "monthly_rate_percent": cash, "savings_rate_percent": savings,
                 "monthly_cash": svc.calc_monthly(principal, cash), "monthly_savings": svc.calc_monthly(principal, savings),
                 "planned_savings_total": round(svc.calc_monthly(principal, savings) * data["duration_months"], 2),
                 "start_date": str(data["start_date"]), "duration_months": data["duration_months"],
                 "end_date": svc.add_months(date.fromisoformat(str(data["start_date"])), data["duration_months"]).isoformat()}
        clauses = [
            "המסלול יופעל רק לאחר חתימת המשקיע ואישור תנאיו. עד אז לא נפתחת קרן פעילה ולא נצברת תשואה מכוח הצעה זו.",
            "מועד התחלת המסלול הוא המאוחר מבין התאריך המוצג לבין יום חתימת המשקיע. התקופה המוסכמת נמדדת ממועד התחלה זה.",
            f"משך המסלול הוא {data['duration_months']} חודשים. אין אפשרות למשוך את הקרן לפני תום התקופה המוסכמת.",
            "שיעורי ההחזר והחיסכון המפורטים בטבלת התנאים הם ההתחייבויות למשקיע במסלול זה; רכיב ששיעורו אפס אינו נצבר או משולם.",
            "ההחזר החודשי במזומן והחיסכון הם רכיבים נפרדים. החיסכון נצבר על הקרן בלבד, בחודשים מלאים, ללא ריבית דריבית.",
            "הקרן כוללת את מלוא היתרה הזמינה המצוינת ואת תוספת הכסף החדש. אין כפל זיכוי של סכומים שכבר נמשכו או שולמו.",
            "בתום התקופה לא יחודש המסלול באופן אוטומטי. סיום המסלול יושלם באמצעות הסכם סיום חתום; מסלול נוסף דורש הסכם חדש וחתימה חדשה.",
            "תנאים אלה אינם גורעים מזכויות שאין להתנות עליהן על פי דין. שינוי תנאי המשקיע מחייב הסכמה מתועדת חדשה.",
        ]
    snapshot = document_snapshot(db, investor=investor, kind=kind, terms=terms, clauses=clauses, requested_on=notice.requested_on)
    token = secrets.token_urlsafe(32)
    agreement = PlanAgreement(investor_id=investor_id, plan_id=plan_id, kind=kind,
        snapshot=snapshot, private_terms=private, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        document_hash=digest(snapshot), actor_user_id=actor_id, notice_id=notice_id, expires_at=utcnow() + timedelta(days=14))
    db.add(agreement); db.flush()
    from app.services.activity_service import log_activity
    log_activity(db, kind="plan_agreement_prepared", title=f"{snapshot['title']} · {investor.name}",
                 body="המסמך ממתין לחתימת המשקיע; טרם בוצעה פעולה כספית", actor_name=snapshot["manager_name"],
                 investor_id=investor.id, investor_name=investor.name, entity_type="agreement", entity_id=agreement.id, href="/investors")
    return agreement, token


def serialize(row: PlanAgreement) -> dict:
    return {"id": row.id, "investor_id": row.investor_id, "plan_id": row.plan_id,
            "kind": row.kind, "status": row.status, "snapshot": row.snapshot,
            "document_hash": row.document_hash, "created_at": row.created_at, "expires_at": row.expires_at,
            "signed_at": row.signed_at, "signed_name": row.signed_name, "signature_png": row.signature_png,
            "execution_details": row.execution_details}


def by_token(db: Session, token: str):
    if len(token) < 40 or len(token) > 100:
        raise ValueError("קישור לא תקין")
    row = db.query(PlanAgreement).filter(PlanAgreement.token_hash == hashlib.sha256(token.encode()).hexdigest()).first()
    if not row:
        raise ValueError("המסמך לא נמצא")
    if row.status not in {"pending", "signed"} or row.expires_at.replace(tzinfo=timezone.utc) < utcnow():
        raise ValueError("הקישור בוטל או פג תוקפו. יש לבקש קישור חדש מהמנהל")
    return row


def sign(db: Session, row: PlanAgreement, *, name: str, signature: str, accepted: bool, document_hash: str):
    investor = wallet.lock_investor(db, row.investor_id)
    row = db.query(PlanAgreement).filter(PlanAgreement.id == row.id).with_for_update().populate_existing().one()
    if row.status == "signed":
        return row
    if row.status != "pending" or row.expires_at.replace(tzinfo=timezone.utc) < utcnow():
        raise ValueError("המסמך אינו ממתין לחתימה או שפג תוקפו")
    if not accepted or len(name.strip()) < 2 or len(name.strip()) > 80:
        raise ValueError("יש להקליד שם מלא ולאשר את התנאים")
    if document_hash != row.document_hash or digest(row.snapshot) != document_hash:
        raise ValueError("גרסת המסמך השתנתה. יש לטעון את ההסכם מחדש")
    png = svc._validate_signature_png(signature)
    import base64, binascii
    try:
        raw = base64.b64decode(png.split(",", 1)[1], validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("נתוני החתימה אינם תקינים") from None
    if not raw.startswith(b"\x89PNG\r\n\x1a\n") or len(raw) < 40:
        raise ValueError("יש לחתום בלוח החתימה")
    if row.kind == "close":
        plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == row.plan_id).with_for_update().one()
        current = closing_terms(plan, include_months="savings_months" in row.snapshot["terms"])
        current["transfer_total"] = round(current["principal"] + current["savings"], 2)
        if current != row.snapshot["terms"]:
            raise ValueError("נתוני המסלול השתנו. יש לבקש מהמנהל הסכם סיום מעודכן")
    else:
        terms = row.snapshot["terms"]
        if (investor.available_balance_cents or 0) != wallet.cents(terms["available_balance"]):
            raise ValueError("היתרה הזמינה השתנתה. יש להכין הסכם חדש")
    changed = db.execute(update(PlanAgreement).where(PlanAgreement.id == row.id, PlanAgreement.status == "pending").values(status="signed").execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        raise ValueError("המסמך כבר טופל")
    if row.kind == "close":
        wallet.close_plan(db, row.plan_id, row.actor_user_id)
        row.execution_details = {"closed_on": israel_today().isoformat(), "transfer_total": row.snapshot["terms"]["transfer_total"]}
    else:
        data = dict(row.private_terms)
        additional = data.pop("additional_funds", None)
        data.pop("operation_key", None); data.pop("generate_schedule", None)
        data["start_date"] = max(date.fromisoformat(data["start_date"]), israel_today())
        plan = wallet.fund_plan(db, data, additional, f"agreement:{row.id}", row.actor_user_id)
        row.plan_id = plan.id
        row.execution_details = {"start_date": plan.start_date.isoformat(), "end_date": end_date(plan).isoformat(), "duration_months": plan.duration_months}
    row.status = "signed"; row.signed_at = utcnow(); row.signed_name = name.strip(); row.signature_png = png
    from app.services.activity_service import log_activity
    log_activity(db, kind="plan_closed" if row.kind == "close" else "plan_created", title=f"{row.snapshot['title']} נחתם · {investor.name}",
                 body="חתימת המשקיע נשמרה והשינוי בוצע בהתאם להסכם", actor_name=name.strip(),
                 investor_id=investor.id, investor_name=investor.name, entity_type="agreement", entity_id=row.id, href="/documents", severity="success")
    db.flush()
    return row
