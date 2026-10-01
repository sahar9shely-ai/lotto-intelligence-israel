from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.investments import Investor, InvestmentPlan, WalletEntry
from app.services import investment_service as svc
from app.services.israel_business_days import israel_today


def cents(value) -> int:
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.01")):
            raise ValueError("סכום חייב להיות חיובי או אפס, עם עד שתי ספרות אחרי הנקודה")
        result = int(amount * 100)
        if result > 2_000_000_000:
            raise ValueError("הסכום גדול מדי")
        return result
    except (InvalidOperation, TypeError):
        raise ValueError("סכום לא תקין") from None


def fingerprint(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def lock_investor(db: Session, investor_id: int) -> Investor:
    investor = db.query(Investor).filter(Investor.id == investor_id).with_for_update().populate_existing().first()
    if not investor:
        raise ValueError("המשקיע לא נמצא")
    return investor


def replay(db: Session, key: str, investor_id: int, digest: str):
    entry = db.query(WalletEntry).filter(WalletEntry.operation_key == key).first()
    if entry and (entry.investor_id != investor_id or entry.request_fingerprint != digest):
        raise ValueError("מזהה הפעולה כבר שימש לבקשה אחרת")
    return entry


def movement(db: Session, investor: Investor, amount: int, kind: str, key: str,
             digest: str, actor_id: int, plan_id: int | None = None):
    before = investor.available_balance_cents or 0
    after = before + amount
    if after < 0 or after > 2_000_000_000:
        raise ValueError("אין יתרה מספקת או שהיתרה חורגת מהמגבלה")
    result = db.execute(update(Investor).where(
        Investor.id == investor.id, Investor.available_balance_cents == before
    ).values(available_balance_cents=after).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise ValueError("היתרה השתנתה. רעננו ונסו שוב")
    investor.available_balance_cents = after
    entry = WalletEntry(investor_id=investor.id, investor_name=investor.name, plan_id=plan_id, operation_key=key,
                        operation_type=kind, amount_cents=amount, balance_after_cents=after,
                        request_fingerprint=digest, actor_user_id=actor_id)
    db.add(entry)
    db.flush()
    return entry


def close_plan(db: Session, plan_id: int, actor_id: int):
    reference = db.get(InvestmentPlan, plan_id)
    if not reference:
        raise ValueError("המסלול לא נמצא")
    investor = lock_investor(db, reference.investor_id)
    key = f"close:{plan_id}"
    digest = fingerprint({"plan_id": plan_id})
    existing = replay(db, key, investor.id, digest)
    if existing:
        return reference
    plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id).with_for_update().populate_existing().one()
    if plan.status != "active" or plan.closed_on:
        raise ValueError("ניתן לסגור רק מסלול פעיל")
    today = israel_today()
    if plan.start_date > today:
        raise ValueError("לא ניתן לסגור מסלול שטרם התחיל")
    principal = cents(plan.principal)
    accrued = svc.accrued_savings_for_plan(plan, today)
    savings = cents(svc.available_savings_for_plan(plan, today))
    result = db.execute(update(InvestmentPlan).where(
        InvestmentPlan.id == plan.id, InvestmentPlan.status == "active", InvestmentPlan.closed_on.is_(None)
    ).values(status="completed", closed_on=today).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise ValueError("המסלול כבר נסגר")
    plan.status = "completed"
    plan.closed_on = today
    plan.closing_principal_cents = principal
    plan.closing_savings_cents = savings
    plan.closing_accrued_savings = accrued
    for payment in plan.payments:
        if payment.status in {"scheduled", "awaiting_confirmation"} and payment.due_date > today:
            payment.status = "skipped"
    movement(db, investor, principal + savings, "plan_close", key, digest, actor_id, plan.id)
    return plan


def deposit(db: Session, investor_id: int, amount, operation_key: str, actor_id: int):
    value = cents(amount)
    if value <= 0:
        raise ValueError("סכום התוספת חייב להיות גדול מאפס")
    investor = lock_investor(db, investor_id)
    digest = fingerprint({"investor_id": investor_id, "amount_cents": value, "kind": "deposit"})
    existing = replay(db, operation_key, investor_id, digest)
    if existing:
        return existing
    return movement(db, investor, value, "deposit", operation_key, digest, actor_id)


def withdraw(db: Session, investor_id: int, amount, operation_key: str, actor_id: int):
    value = cents(amount)
    if value <= 0:
        raise ValueError("סכום המשיכה חייב להיות גדול מאפס")
    investor = lock_investor(db, investor_id)
    digest = fingerprint({"investor_id": investor_id, "amount_cents": value, "kind": "withdraw"})
    existing = replay(db, operation_key, investor_id, digest)
    if existing:
        return existing
    return movement(db, investor, -value, "withdraw", operation_key, digest, actor_id)


def fund_plan(db: Session, data: dict, additional_funds, operation_key, actor_id: int):
    investor = lock_investor(db, data["investor_id"])
    digest = fingerprint({**data, "additional_funds": additional_funds})
    key = operation_key or str(uuid4())
    existing = replay(db, key, investor.id, digest)
    if existing:
        return db.get(InvestmentPlan, existing.plan_id)
    balance = investor.available_balance_cents or 0
    declared = cents(data["principal"])
    additional = cents(additional_funds) if additional_funds is not None else declared - balance
    if additional < 0 or declared != balance + additional or declared <= 0:
        raise ValueError("הקרן החדשה חייבת לכלול את כל היתרה הזמינה ואת תוספת הכסף")
    if additional:
        movement(db, investor, additional, "deposit", f"deposit:{key}", digest, actor_id)
    kind, cash, savings = svc.normalize_plan_rates(data["plan_type"], data["monthly_rate_percent"], data["savings_rate_percent"])
    data.update(plan_type=kind, monthly_rate_percent=cash, savings_rate_percent=savings,
                accrual_principal=declared / 100, savings_redeemed_total=0,
                manager_savings_start_date=max(data["start_date"], israel_today()))
    plan = InvestmentPlan(**data)
    db.add(plan)
    db.flush()
    movement(db, investor, -declared, "plan_funding", key, digest, actor_id, plan.id)
    svc.generate_payment_schedule(db, plan, commit=False)
    return plan
