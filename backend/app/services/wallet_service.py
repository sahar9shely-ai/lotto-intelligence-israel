from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.investments import Investor, InvestmentPlan, WalletEntry, WalletTransfer
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


class InvestorNotFoundError(ValueError):
    pass


def lock_investor(db: Session, investor_id: int) -> Investor:
    investor = db.query(Investor).filter(Investor.id == investor_id).with_for_update().populate_existing().first()
    if not investor:
        raise InvestorNotFoundError("המשקיע לא נמצא")
    return investor


def require_no_current_plan(db: Session, investor_id: int, *, excluding_plan_id: int | None = None):
    query = db.query(InvestmentPlan.id).filter(InvestmentPlan.investor_id == investor_id,
        InvestmentPlan.status.in_(("active", "paused")), InvestmentPlan.closed_on.is_(None))
    if excluding_plan_id is not None:
        query = query.filter(InvestmentPlan.id != excluding_plan_id)
    if query.first():
        raise ValueError("למשקיע כבר קיים מסלול פעיל. יש לסיים אותו בחתימה לפני פתיחת מסלול נוסף")


def replay(db: Session, key: str, investor_id: int, digest: str):
    entry = db.query(WalletEntry).filter(WalletEntry.operation_key == key).first()
    if entry and (entry.investor_id != investor_id or entry.request_fingerprint != digest):
        raise ValueError("מזהה הפעולה כבר שימש לבקשה אחרת")
    return entry


def movement(db: Session, investor: Investor, amount: int, kind: str, key: str,
             digest: str, actor_id: int, plan_id: int | None = None, *,
             transfer_id: str | None = None, counterparty: Investor | None = None,
             admin_notes: str | None = None):
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
                        request_fingerprint=digest, actor_user_id=actor_id,
                        transfer_id=transfer_id, admin_notes=admin_notes,
                        counterparty_investor_id=counterparty.id if counterparty else None,
                        counterparty_name=counterparty.name if counterparty else None)
    db.add(entry)
    db.flush()
    return entry


def _transfer_replay(db: Session, key: str, digest: str) -> WalletTransfer | None:
    receipt = db.query(WalletTransfer).filter(WalletTransfer.operation_key == key).first()
    if receipt:
        if receipt.request_fingerprint != digest:
            raise ValueError("מזהה הפעולה כבר שימש לבקשה אחרת")
        return receipt
    # Transfers share the operation-key namespace with deposits/withdrawals.
    if db.query(WalletEntry.id).filter(WalletEntry.operation_key == key).first():
        raise ValueError("מזהה הפעולה כבר שימש לבקשה אחרת")
    return None


def begin_wallet_write(db: Session) -> None:
    """Ensure SQLite locks/outer commit ownership before wallet-sensitive reads."""
    if db.get_bind().dialect.name == "sqlite":
        connection = db.connection()
        # sqlite3 legacy mode does not BEGIN on SELECT or SAVEPOINT. Without an
        # outer transaction, RELEASE SAVEPOINT would commit before the caller.
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")


def transfer(db: Session, source_investor_id: int, recipient_investor_id: int,
             amount, operation_key: str, actor_id: int, *, request_confirmed: bool,
             expected_source_balance, notes: str | None = None) -> WalletTransfer:
    """Move available cents only; caller commits both ledger sides together."""
    from app.models.auth import User
    from app.security.auth import is_system_admin

    actor = db.get(User, actor_id)
    if not actor or not actor.is_active or not is_system_admin(actor):
        raise PermissionError("העברה פנימית זמינה למנהל המערכת בלבד")
    if request_confirmed is not True:
        raise ValueError("יש לאשר שהעברת הכספים התבקשה")
    if any(type(value) is not int or value <= 0 for value in (source_investor_id, recipient_investor_id)):
        raise ValueError("מזהה משקיע לא תקין")
    if source_investor_id == recipient_investor_id:
        raise ValueError("יש לבחור שני משקיעים שונים")
    if not isinstance(operation_key, str) or not 8 <= len(operation_key) <= 80 or not operation_key.strip():
        raise ValueError("מזהה הפעולה לא תקין")
    if notes is not None and (not isinstance(notes, str) or len(notes) > 500):
        raise ValueError("הערה יכולה להכיל עד 500 תווים")
    notes = (notes.strip() or None) if notes is not None else None
    value = cents(amount)
    expected = cents(expected_source_balance)
    if value <= 0:
        raise ValueError("סכום ההעברה חייב להיות גדול מאפס")
    digest = fingerprint({"kind": "transfer", "source_investor_id": source_investor_id,
                          "recipient_investor_id": recipient_investor_id, "amount_cents": value,
                          "expected_source_balance_cents": expected, "notes": notes})
    existing = _transfer_replay(db, operation_key, digest)
    if existing:
        return existing  # Receipt wins over a now-stale expected balance.

    begin_wallet_write(db)

    with db.begin_nested():
        investors = {investor_id: lock_investor(db, investor_id)
                     for investor_id in sorted((source_investor_id, recipient_investor_id))}
        # A concurrent transaction may have committed while we waited for locks.
        existing = _transfer_replay(db, operation_key, digest)
        if existing:
            return existing
        source, recipient = investors[source_investor_id], investors[recipient_investor_id]
        if svc.is_admin_shell(source) or svc.is_admin_shell(recipient):
            raise ValueError("לא ניתן להעביר כסף לחשבון ניהול המערכת או ממנו")
        source_before = source.available_balance_cents or 0
        recipient_before = recipient.available_balance_cents or 0
        if source_before != expected:
            raise ValueError("היתרה השתנתה. רעננו ובדקו את הסכום לפני העברה")
        if value > source_before:
            raise ValueError("אין יתרה זמינה מספקת להעברה")
        if recipient_before + value > 2_000_000_000:
            raise ValueError("יתרת המקבל תחרוג מהמגבלה")
        receipt = WalletTransfer(id=str(uuid4()), operation_key=operation_key, request_fingerprint=digest,
                                 source_investor_id=source.id, recipient_investor_id=recipient.id,
                                 amount_cents=value, source_balance_after_cents=source_before - value,
                                 recipient_balance_after_cents=recipient_before + value)
        db.add(receipt)
        db.flush()
        movement(db, source, -value, "transfer_out", operation_key, digest, actor_id,
                 transfer_id=receipt.id, counterparty=recipient, admin_notes=notes)
        movement(db, recipient, value, "transfer_in", f"transfer:{receipt.id}:in", digest, actor_id,
                 transfer_id=receipt.id, counterparty=source, admin_notes=notes)
        return receipt


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
    begin_wallet_write(db)
    investor = lock_investor(db, data["investor_id"])
    digest = fingerprint({**data, "additional_funds": additional_funds})
    key = operation_key or str(uuid4())
    existing = replay(db, key, investor.id, digest)
    if existing:
        return db.get(InvestmentPlan, existing.plan_id)
    require_no_current_plan(db, investor.id)
    balance = investor.available_balance_cents or 0
    declared = cents(data["principal"])
    additional = cents(additional_funds) if additional_funds is not None else declared - balance
    if additional < 0 or declared != balance + additional or declared <= 0:
        raise ValueError("הקרן החדשה חייבת לכלול את כל היתרה הזמינה ואת תוספת הכסף")
    kind, cash, savings = svc.normalize_plan_rates(data["plan_type"], data["monthly_rate_percent"], data["savings_rate_percent"])
    first_due = data.get("first_payment_date") or svc.add_months(data["start_date"], 1)
    if first_due < svc.add_months(data["start_date"], 1):
        raise ValueError("התשלום הראשון יכול לחול רק חודש לפחות לאחר תחילת המסלול")
    if additional:
        movement(db, investor, additional, "deposit", f"deposit:{key}", digest, actor_id)
    data.update(plan_type=kind, monthly_rate_percent=cash, savings_rate_percent=savings,
                first_payment_date=first_due,
                accrual_principal=declared / 100, savings_redeemed_total=0,
                manager_savings_start_date=max(data["start_date"], israel_today()))
    plan = InvestmentPlan(**data)
    db.add(plan)
    db.flush()
    movement(db, investor, -declared, "plan_funding", key, digest, actor_id, plan.id)
    svc.generate_payment_schedule(db, plan, commit=False)
    return plan
