"""Opt-in repair of verified opening schedules. No global date migration."""
from __future__ import annotations

import hashlib
import json
import logging
from contextlib import nullcontext
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.investments import InvestmentPlan, Payment, PlanAgreement
from app.services import investment_service as svc, wallet_service as wallet
from app.services.israel_business_days import israel_today

logger = logging.getLogger(__name__)


def reconcile_opening_payment_dates(db: Session, plan_ids: list[int], *, dry_run: bool = True,
                                    signed_since: datetime | None = None, signed_until: datetime | None = None,
                                    expected_digest: str | None = None) -> dict:
    """Propose or atomically apply one bounded, explicitly authorized repair.

    Only untouched scheduled rows of already-started, active signed opening
    agreements qualify. Signature snapshots, principal, wallet, and other plans
    never change. The caller owns the outer commit/rollback.
    """
    if not plan_ids or len(plan_ids) > 100 or any(type(value) is not int or value <= 0 for value in plan_ids):
        raise ValueError("יש לבחור עד מאה מזהי מסלול מאומתים ומפורשים")
    from app.services.agreement_service import digest as agreement_digest
    ids = sorted(set(plan_ids))
    if not dry_run:
        wallet.begin_wallet_write(db)
    with (nullcontext() if dry_run else db.begin_nested()):
        if not dry_run:
            investor_ids = db.query(InvestmentPlan.investor_id).filter(InvestmentPlan.id.in_(ids)).distinct().all()
            for (investor_id,) in sorted(investor_ids):
                wallet.lock_investor(db, investor_id)
        plan_query = db.query(InvestmentPlan).filter(InvestmentPlan.id.in_(ids)).order_by(InvestmentPlan.id).populate_existing()
        if not dry_run:
            plan_query = plan_query.with_for_update()
        plans = {plan.id: plan for plan in plan_query.all()}
        proposals, conflicts, ready = [], [], []
        for plan_id in ids:
            plan = plans.get(plan_id)
            if not plan:
                conflicts.append({"plan_id": plan_id, "reason": "plan_not_found"}); continue
            query = db.query(PlanAgreement).filter(PlanAgreement.plan_id == plan_id,
                PlanAgreement.kind == "open", PlanAgreement.status == "signed")
            if signed_since:
                query = query.filter(PlanAgreement.signed_at >= signed_since)
            if signed_until:
                query = query.filter(PlanAgreement.signed_at <= signed_until)
            if not dry_run:
                query = query.with_for_update()
            agreement = query.populate_existing().one_or_none()
            payment_query = db.query(Payment).filter(Payment.plan_id == plan_id).order_by(Payment.month_number).populate_existing()
            if not dry_run:
                payment_query = payment_query.with_for_update()
            payments = payment_query.all()
            reason = None
            if plan.status != "active" or plan.closed_on:
                reason = "closed_or_inactive"
            elif not agreement or not agreement.signed_at or not agreement.signature_png or agreement_digest(agreement.snapshot) != agreement.document_hash:
                reason = "no_verified_signed_opening_in_scope"
            elif svc.pending_date_amendment(db, plan_id):
                reason = "pending_date_amendment_requires_signature"
            elif plan.start_date > israel_today():
                reason = "future_start_requires_explicit_review"
            elif plan.first_payment_date is not None:
                if plan.first_payment_date == svc.add_months(plan.start_date, 1) and all(
                    p.due_date == svc.payment_due_date(plan, p.month_number) for p in payments
                ):
                    proposals.append({"plan_id": plan.id, "status": "already_correct"})
                    continue
                reason = "existing_first_payment_date_requires_review"
            elif len(payments) != plan.duration_months or {p.month_number for p in payments} != set(range(1, plan.duration_months + 1)):
                reason = "incomplete_or_nonstandard_schedule"
            elif any(p.status != "scheduled" or p.paid_at is not None or p.confirmation_requested_at is not None for p in payments):
                reason = "payment_paid_sent_or_otherwise_processed"
            elif any(p.due_date != svc.add_months(plan.start_date, p.month_number - 1) for p in payments):
                reason = "custom_dates_require_explicit_review"
            if reason:
                conflicts.append({"plan_id": plan.id, "reason": reason}); continue
            proposal = {"plan_id": plan.id, "investor_id": plan.investor_id, "agreement_id": agreement.id,
                "agreement_document_hash": agreement.document_hash, "signed_at": agreement.signed_at.isoformat(),
                "start_date": plan.start_date.isoformat(), "first_payment_date": svc.add_months(plan.start_date, 1).isoformat(),
                "principal": plan.principal, "status": "would_repair",
                "payments": [{"id": p.id, "month_number": p.month_number, "old_due_date": p.due_date.isoformat(),
                    "new_due_date": svc.add_months(plan.start_date, p.month_number).isoformat(),
                    "investor_amount": p.investor_amount, "manager_amount": p.manager_amount, "status": p.status} for p in payments]}
            proposals.append(proposal); ready.append((plan, payments, proposal))
        fingerprint = hashlib.sha256(json.dumps({"plan_ids": ids, "proposals": proposals, "conflicts": conflicts},
            sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if expected_digest is not None and fingerprint != expected_digest:
            raise ValueError("נתוני בדיקת התיקון השתנו; יש לבדוק מחדש לפני הפעלה")
        if not dry_run and conflicts:
            raise ValueError("תיקון הלוח נעצר ללא שינוי עקב מסלול הדורש בדיקה: " + json.dumps(conflicts, ensure_ascii=False))
        if not dry_run:
            from app.services.activity_service import log_activity
            for plan, payments, proposal in ready:
                plan.first_payment_date = svc.add_months(plan.start_date, 1)
                for payment in payments:
                    payment.due_date = svc.payment_due_date(plan, payment.month_number)
                log_activity(db, kind="plan_payment_timing_repaired", title=f"תוקן מועד תשלום ראשון · מסלול #{plan.id}",
                    body="לוח התשלומים הוזז לחודש לאחר התחלת המסלול; החתימה ותנועות הכסף לא שונו",
                    investor_id=plan.investor_id, investor_name=plan.investor.name, entity_type="plan", entity_id=plan.id,
                    href="/investors", meta={"repair_version": 1, "review_digest": fingerprint, "before_after": proposal})
            db.flush()
        return {"dry_run": dry_run, "plan_ids": ids, "review_digest": fingerprint,
                "proposals": proposals, "conflicts": conflicts, "repaired_count": len(ready) if not dry_run else 0}


def run_configured_payment_timing_repairs(engine, configured_ids: str) -> list[dict]:
    """Empty by default; one transaction per verified configured ID at startup."""
    if not configured_ids or not configured_ids.strip():
        return []
    try:
        ids = sorted(set(int(part.strip()) for part in configured_ids.split(",")))
        if len(ids) > 100 or any(value <= 0 for value in ids):
            raise ValueError("invalid scope")
    except ValueError:
        logger.error("Invalid PAYMENT_TIMING_REPAIR_PLAN_IDS; no schedules changed")
        return []
    reports = []
    for plan_id in ids:
        with Session(engine, expire_on_commit=False) as db:
            try:
                preview = reconcile_opening_payment_dates(db, [plan_id])
                if preview["conflicts"]:
                    logger.warning("Payment timing repair skipped: %s", preview["conflicts"])
                    reports.append(preview); continue
                result = reconcile_opening_payment_dates(db, [plan_id], dry_run=False, expected_digest=preview["review_digest"])
                db.commit(); reports.append(result)
            except Exception:
                db.rollback()
                logger.exception("Payment timing repair skipped for plan %s", plan_id)
    return reports
