"""Signed date amendments and atomic replacement of unsigned opening offers."""
from __future__ import annotations
import hashlib
import secrets
from datetime import date, timedelta
from sqlalchemy.orm import Session
from app.models.auth import User
from app.models.investments import Investor, InvestmentPlan, Payment, PlanAgreement, PlanNotice, utcnow
from app.security.auth import is_system_admin
from app.services import agreement_service as agreements, investment_service as svc, wallet_service as wallet
from app.services.israel_business_days import israel_today


def require_admin(db: Session, actor_id: int):
    actor = db.get(User, actor_id)
    if not actor or not is_system_admin(actor):
        raise ValueError("עדכון הסכמים זמין לאדמין בלבד")


def amendment_state(db: Session, plan_id: int, *, lock: bool = False):
    query = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id).populate_existing()
    if lock:
        query = query.with_for_update()
    plan = query.one_or_none()
    if not plan or plan.status != "active" or plan.closed_on:
        raise ValueError("עדכון מועדים מחייב מסלול פעיל שלא נסגר")
    wallet.require_no_current_plan(db, plan.investor_id, excluding_plan_id=plan.id)
    original_query = db.query(PlanAgreement).filter(PlanAgreement.plan_id == plan_id,
        PlanAgreement.kind == "open", PlanAgreement.status == "signed").order_by(PlanAgreement.id)
    if lock:
        original_query = original_query.with_for_update()
    original = original_query.populate_existing().first()
    if not original or not original.signed_at or not original.signature_png or agreements.digest(original.snapshot) != original.document_hash:
        raise ValueError("לא נמצא הסכם פתיחה חתום ותקין למסלול")
    payment_query = db.query(Payment).filter(Payment.plan_id == plan_id).order_by(Payment.month_number).populate_existing()
    if lock:
        payment_query = payment_query.with_for_update()
    payments = payment_query.all()
    if len(payments) != plan.duration_months or {p.month_number for p in payments} != set(range(1, plan.duration_months + 1)):
        raise ValueError("לוח התשלומים אינו שלם; נדרשת בדיקה פרטנית")
    if any(p.status != "scheduled" or p.paid_at or p.confirmation_requested_at for p in payments):
        raise ValueError("לא ניתן לעדכן מועדים אחרי תשלום או שליחת בקשת אישור קבלה")
    if svc.completed_months(plan.start_date, israel_today(), cap=plan.duration_months) > 0 or plan.savings_actions or plan.savings_redeemed_total or plan.rollover_savings_balance or svc.accrued_savings_for_plan(plan, israel_today()) or svc.manager_savings_for_plan(plan, israel_today()):
        raise ValueError("לא ניתן לעדכן מועדים לאחר השלמת חודש, צבירת חיסכון או פעולה כספית במסלול")
    state = {"plan_id": plan.id, "start_date": str(plan.start_date), "first_payment_date": str(plan.first_payment_date) if plan.first_payment_date else None,
        "principal": plan.principal, "accrual_principal": plan.accrual_principal, "duration_months": plan.duration_months,
        "plan_type": plan.plan_type, "monthly_rate_percent": plan.monthly_rate_percent, "savings_rate_percent": plan.savings_rate_percent,
        "manager_fee_percent": plan.manager_fee_percent, "manager_savings_rate_percent": plan.manager_savings_rate_percent,
        "manager_savings_start_date": str(plan.manager_savings_start_date) if plan.manager_savings_start_date else None,
        "opening_agreement_id": original.id, "opening_document_hash": original.document_hash,
        "payments": [{"id": p.id, "month_number": p.month_number, "due_date": str(p.due_date), "investor_amount": p.investor_amount,
            "manager_amount": p.manager_amount, "status": p.status} for p in payments]}
    return plan, payments, original, state


def date_amendment_preview(db: Session, plan_id: int, start_date: date, first_payment_date: date | None = None, notes: str | None = None) -> dict:
    plan, payments, original, state = amendment_state(db, plan_id)
    first = first_payment_date or svc.add_months(start_date, 1)
    if first != svc.add_months(start_date, 1):
        raise ValueError("מועד התשלום הראשון חייב להיות חודש לאחר תאריך ההתחלה המוסכם")
    # Do not establish an already-completed accrual period through a date edit.
    if svc.completed_months(start_date, israel_today(), cap=plan.duration_months) > 0:
        raise ValueError("התאריכים החדשים כבר כוללים חודש שהושלם; נדרשת בדיקה פרטנית")
    terms = {"plan_id": plan.id, "principal": plan.principal, "plan_type": plan.plan_type,
        "monthly_rate_percent": plan.monthly_rate_percent, "savings_rate_percent": plan.savings_rate_percent,
        "monthly_cash": svc.calc_monthly(plan.principal, plan.monthly_rate_percent),
        "monthly_savings": svc.calc_monthly(plan.principal, plan.savings_rate_percent),
        "duration_months": plan.duration_months, "start_date": start_date.isoformat(), "first_payment_date": first.isoformat(),
        "end_date": svc.add_months(start_date, plan.duration_months).isoformat(), "payment_timing": "month_after_start",
        "previous_start_date": plan.start_date.isoformat(), "previous_first_payment_date": payments[0].due_date.isoformat(),
        "opening_agreement_id": original.id, "opening_document_hash": original.document_hash}
    clauses = ["הצדדים מסכימים לעדכון מועדי המסלול הקיים המפורטים בטבלה. העדכון יבוצע רק לאחר חתימת המשקיע על מסמך זה.",
        "מועד תחילת התקופה ומועד התשלום הראשון המפורטים כאן הם התאריכים המוסכמים, גם אם החתימה תתבצע לאחר תאריך ההתחלה, כל עוד לא בוצע תשלום או הושלם חודש צבירה המחייב בדיקה נוספת.",
        "התשלום הראשון יחול לאחר חודש מלא ממועד התחלת התקופה המוסכם; התשלומים הבאים יחולו מדי חודש לפי אותו לוח.",
        "אין פתיחת מסלול נוסף ואין חיוב או זיכוי ביתרה הזמינה. הקרן, שיעורי ההחזר והחיסכון ומשך המסלול אינם משתנים; רק מועדי התקופה ולוח התשלומים מתעדכנים.",
        "הסכם הפתיחה המקורי והחתימה עליו נשמרים בהיסטוריה. מסמך זה משנה רק את המועדים המפורטים בו; יתר תנאי ההסכם המקורי נותרים בתוקף.",
        "תשלומים וחובות ממסלולים קודמים אינם מבוטלים או נזקפים שוב עקב עדכון זה."]
    snapshot = agreements.document_snapshot(db, investor=plan.investor, kind="amend_dates", terms=terms, clauses=clauses, requested_on=israel_today())
    snapshot["before_state_hash"] = agreements.digest(state)
    if notes:
        snapshot["amendment_notes"] = notes
    return {"kind": "amend_dates", "snapshot": snapshot, "document_hash": agreements.digest(snapshot), "can_prepare": True, "calculated_on": israel_today()}


def issue_date_amendment(db: Session, plan_id: int, *, start_date: date, first_payment_date: date | None,
                         notes: str | None, actor_id: int, reviewed_document_hash: str):
    require_admin(db, actor_id)
    wallet.begin_wallet_write(db)
    reference = db.get(InvestmentPlan, plan_id)
    if not reference:
        raise ValueError("המסלול לא נמצא")
    wallet.lock_investor(db, reference.investor_id)
    plan, payments, original, state = amendment_state(db, plan_id, lock=True)
    if db.query(PlanAgreement).filter(PlanAgreement.investor_id == plan.investor_id, PlanAgreement.status == "pending").first():
        raise ValueError("קיים הסכם הממתין לחתימה; יש להשלים או לבטל אותו תחילה")
    preview = date_amendment_preview(db, plan_id, start_date, first_payment_date, notes)
    if reviewed_document_hash != preview["document_hash"]:
        raise ValueError("נתוני העדכון השתנו; יש לעיין בסיכום המעודכן ולאשר אותו שוב")
    notice = PlanNotice(investor_id=plan.investor_id, purpose="renew", requested_on=israel_today(), actor_user_id=actor_id, notes=notes)
    db.add(notice); db.flush()
    token = secrets.token_urlsafe(32)
    row = PlanAgreement(investor_id=plan.investor_id, plan_id=plan.id, kind="amend_dates", snapshot=preview["snapshot"],
        private_terms={"before_state": state}, token_hash=hashlib.sha256(token.encode()).hexdigest(), document_hash=preview["document_hash"],
        actor_user_id=actor_id, notice_id=notice.id, expires_at=utcnow() + timedelta(days=14))
    db.add(row); db.flush()
    from app.services.activity_service import log_activity
    log_activity(db, kind="plan_agreement_prepared", title=f"הסכם עדכון מועדי מסלול · {plan.investor.name}",
        body="המסלול ולוח התשלומים טרם השתנו; העדכון ממתין לחתימת המשקיע", investor_id=plan.investor_id,
        investor_name=plan.investor.name, entity_type="agreement", entity_id=row.id, href="/documents")
    return row, token


def validate_date_amendment(db: Session, row: PlanAgreement):
    plan, payments, original, state = amendment_state(db, row.plan_id, lock=True)
    if state != row.private_terms["before_state"] or agreements.digest(state) != row.snapshot["before_state_hash"]:
        raise ValueError("נתוני המסלול השתנו; יש להכין הסכם עדכון חדש")
    terms = row.snapshot["terms"]
    start, first = date.fromisoformat(terms["start_date"]), date.fromisoformat(terms["first_payment_date"])
    if first != svc.add_months(start, 1) or svc.completed_months(start, israel_today(), cap=plan.duration_months) > 0:
        raise ValueError("מועדי העדכון דורשים הסכם מעודכן")
    return plan, payments


def execute_date_amendment(db: Session, row: PlanAgreement, plan: InvestmentPlan, payments: list[Payment]):
    terms = row.snapshot["terms"]
    plan.start_date = date.fromisoformat(terms["start_date"])
    plan.first_payment_date = date.fromisoformat(terms["first_payment_date"])
    if plan.manager_savings_start_date is not None:
        previous_start = date.fromisoformat(row.private_terms["before_state"]["start_date"])
        plan.manager_savings_start_date = plan.start_date if plan.manager_savings_start_date == previous_start else max(plan.start_date, plan.manager_savings_start_date)
    for payment in payments:
        payment.due_date = svc.payment_due_date(plan, payment.month_number)
    row.execution_details = {"plan_id": plan.id, "start_date": str(plan.start_date), "first_payment_date": str(plan.first_payment_date),
        "end_date": str(svc.add_months(plan.start_date, plan.duration_months)), "duration_months": plan.duration_months,
        "wallet_changed": False, "opening_agreement_id": terms["opening_agreement_id"]}
    db.flush()


def replacement_content(db: Session, agreement_id: int, start_date: date, first_payment_date: date | None, notes: str | None):
    old = db.query(PlanAgreement).filter(PlanAgreement.id == agreement_id).populate_existing().one_or_none()
    if not old or old.kind != "open" or old.status != "pending" or old.plan_id is not None:
        raise ValueError("ניתן להחליף רק הסכם פתיחה הממתין לחתימה")
    if agreements.digest(old.snapshot) != old.document_hash:
        raise ValueError("נתוני ההסכם המקורי אינם תקינים")
    investor = db.get(Investor, old.investor_id)
    if not investor:
        raise ValueError("המשקיע לא נמצא")
    wallet.require_no_current_plan(db, old.investor_id)
    first = first_payment_date or svc.add_months(start_date, 1)
    if first != svc.add_months(start_date, 1):
        raise ValueError("מועד התשלום הראשון חייב להיות חודש לאחר תאריך ההתחלה המוסכם")
    data = dict(old.private_terms)
    data.update(start_date=start_date, first_payment_date=first_payment_date)
    terms, private, clauses = agreements.opening_content(investor, data)
    notice = db.get(PlanNotice, old.notice_id)
    snapshot = agreements.document_snapshot(db, investor=investor, kind="open", terms=terms, clauses=clauses, requested_on=notice.requested_on)
    snapshot.update(supersedes_agreement_id=old.id, supersedes_document_hash=old.document_hash)
    if notes:
        snapshot["replacement_notes"] = notes
    return old, data, snapshot


def opening_replacement_preview(db: Session, agreement_id: int, start_date: date, first_payment_date: date | None = None, notes: str | None = None):
    old, data, snapshot = replacement_content(db, agreement_id, start_date, first_payment_date, notes)
    return {"kind": "open", "snapshot": snapshot, "document_hash": agreements.digest(snapshot), "can_prepare": True, "calculated_on": israel_today()}


def issue_opening_replacement(db: Session, agreement_id: int, *, start_date: date, first_payment_date: date | None,
                             notes: str | None, actor_id: int, reviewed_document_hash: str):
    require_admin(db, actor_id)
    wallet.begin_wallet_write(db)
    reference = db.get(PlanAgreement, agreement_id)
    if not reference:
        raise ValueError("ההסכם לא נמצא")
    wallet.lock_investor(db, reference.investor_id)
    old, data, snapshot = replacement_content(db, agreement_id, start_date, first_payment_date, notes)
    if agreements.digest(snapshot) != reviewed_document_hash:
        raise ValueError("תנאי ההצעה השתנו; יש לעיין בסיכום המעודכן ולאשר אותו שוב")
    return agreements.issue(db, investor_id=old.investor_id, kind="open", actor_id=actor_id, notice_id=old.notice_id, data=data,
        supersedes_agreement_id=old.id, replacement_notes=notes)
