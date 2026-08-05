from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.models.investments import (
    AppSettings,
    Investor,
    InvestmentPlan,
    Payment,
    Quote,
)


def months_between(start: date, end: date) -> int:
    if end < start:
        return 0
    return (end.year - start.year) * 12 + (end.month - start.month)


def add_months(start: date, months: int) -> date:
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    day = min(start.day, monthrange(year, month)[1])
    return date(year, month, day)


def calc_monthly(principal: float, rate_percent: float) -> float:
    return round(principal * (rate_percent / 100.0), 2)


def normalize_plan_rates(
    plan_type: str,
    monthly_rate_percent: float,
    savings_rate_percent: float,
) -> tuple[str, float, float]:
    """Clamp rates to the selected track type."""
    kind = (plan_type or "monthly").strip().lower()
    if kind not in {"monthly", "savings", "hybrid"}:
        kind = "monthly"
    monthly = float(monthly_rate_percent or 0)
    savings = float(savings_rate_percent or 0)
    if kind == "monthly":
        return kind, monthly, 0.0
    if kind == "savings":
        return kind, 0.0, savings
    return kind, monthly, savings


def projected_compound_savings(
    principal: float,
    savings_rate_percent: float,
    duration_months: int,
) -> dict:
    """Savings accrues monthly; every 12 months the balance compounds onto the base."""
    if principal <= 0 or savings_rate_percent <= 0 or duration_months <= 0:
        return {
            "monthly_savings_accrual": 0.0,
            "projected_savings_balance": 0.0,
            "first_year_savings": 0.0,
        }

    initial_monthly = calc_monthly(principal, savings_rate_percent)
    base = principal
    total_savings = 0.0
    year_bucket = 0.0
    first_year_savings = 0.0

    for month in range(1, duration_months + 1):
        accrual = calc_monthly(base, savings_rate_percent)
        year_bucket = round(year_bucket + accrual, 2)
        if month % 12 == 0 or month == duration_months:
            total_savings = round(total_savings + year_bucket, 2)
            if month <= 12:
                first_year_savings = total_savings
            base = round(principal + total_savings, 2)
            year_bucket = 0.0

    return {
        "monthly_savings_accrual": initial_monthly,
        "projected_savings_balance": total_savings,
        "first_year_savings": first_year_savings,
    }


def track_metrics(
    *,
    principal: float,
    plan_type: str,
    monthly_rate_percent: float,
    savings_rate_percent: float,
    manager_fee_percent: float,
    duration_months: int,
) -> dict:
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        plan_type, monthly_rate_percent, savings_rate_percent
    )
    cash_monthly = calc_monthly(principal, monthly_rate)
    manager_monthly = calc_monthly(principal, manager_fee_percent)
    savings = projected_compound_savings(principal, savings_rate, duration_months)
    total_cash = round(cash_monthly * duration_months, 2)
    total_investor = round(total_cash + savings["projected_savings_balance"], 2)
    if kind == "monthly":
        annual = round(cash_monthly * 12, 2)
    else:
        annual = round(cash_monthly * 12 + savings["first_year_savings"], 2)
    return {
        "plan_type": kind,
        "monthly_rate_percent": monthly_rate,
        "savings_rate_percent": savings_rate,
        "monthly_investor_payout": cash_monthly,
        "monthly_manager_fee": manager_monthly,
        "monthly_savings_accrual": savings["monthly_savings_accrual"],
        "projected_savings_balance": savings["projected_savings_balance"],
        "total_cash_payout": total_cash,
        "total_investor_payout": total_investor,
        "total_manager_fee": round(manager_monthly * duration_months, 2),
        "annual_investor_payout": annual,
    }


def ensure_settings(db: Session) -> AppSettings:
    settings = db.query(AppSettings).first()
    if settings is None:
        settings = AppSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def seed_defaults(db: Session) -> dict:
    ensure_settings(db)
    existing = {i.name for i in db.query(Investor).all()}
    created: list[str] = []

    defaults = [
        ("סהר", True),
        ("בר", False),
        ("אופק", False),
        ("אלמוג", False),
        ("שושי", False),
    ]
    for name, is_manager_flag in defaults:
        if name not in existing:
            # Migrate legacy manager placeholder name if present.
            if is_manager_flag and ("מנהל" in existing or "מנהלת" in existing):
                legacy = (
                    db.query(Investor)
                    .filter(
                        Investor.name.in_(("מנהל", "מנהלת")),
                        Investor.is_manager.is_(True),
                    )
                    .first()
                )
                if legacy:
                    old_name = legacy.name
                    legacy.name = name
                    created.append(f"renamed:{old_name}->{name}")
                    continue
            db.add(Investor(name=name, is_manager=is_manager_flag))
            created.append(name)
    db.commit()

    from app.services import auth_service as auth_svc

    users = auth_svc.seed_users(db)
    return {
        "created": created,
        "already_existed": sorted(existing),
        "users": users,
    }


def plan_track_end_date(plan: InvestmentPlan) -> date:
    """Last calendar month of the track (start + duration − 1), by plan terms."""
    return add_months(plan.start_date, max(plan.duration_months, 1) - 1)


def current_savings_for_plan(
    plan: InvestmentPlan, today: Optional[date] = None
) -> float:
    """Savings balance accrued so far (through elapsed months), per plan terms."""
    today = today or date.today()
    _, _, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    if savings_rate <= 0 or plan.duration_months <= 0:
        return 0.0
    elapsed = min(months_between(plan.start_date, today), plan.duration_months)
    if elapsed <= 0:
        return 0.0
    rows = month_savings_ledger(
        principal=plan.principal,
        savings_rate_percent=savings_rate,
        duration_months=plan.duration_months,
    )
    row = next((r for r in rows if r["month_number"] == elapsed), None)
    return float(row["cumulative_savings"]) if row else 0.0


def plan_metrics(plan: InvestmentPlan, today: Optional[date] = None) -> dict:
    today = today or date.today()
    track = track_metrics(
        principal=plan.principal,
        plan_type=getattr(plan, "plan_type", None) or "monthly",
        monthly_rate_percent=plan.monthly_rate_percent,
        savings_rate_percent=getattr(plan, "savings_rate_percent", 0.0) or 0.0,
        manager_fee_percent=plan.manager_fee_percent,
        duration_months=plan.duration_months,
    )
    elapsed = min(months_between(plan.start_date, today), plan.duration_months)
    remaining = max(plan.duration_months - elapsed, 0)
    payments = plan.payments or []
    paid = [p for p in payments if p.status == "paid"]
    return {
        "monthly_investor_payout": track["monthly_investor_payout"],
        "monthly_manager_fee": track["monthly_manager_fee"],
        "monthly_savings_accrual": track["monthly_savings_accrual"],
        "projected_savings_balance": track["projected_savings_balance"],
        "current_savings_balance": current_savings_for_plan(plan, today),
        "track_end_date": plan_track_end_date(plan),
        "total_cash_payout": track["total_cash_payout"],
        "total_investor_payout": track["total_investor_payout"],
        "total_manager_fee": track["total_manager_fee"],
        "annual_investor_payout": track["annual_investor_payout"],
        "months_elapsed": elapsed,
        "months_remaining": remaining,
        "paid_count": len(paid),
        "paid_investor_total": round(sum(p.investor_amount for p in paid), 2),
        "paid_manager_total": round(sum(p.manager_amount for p in paid), 2),
    }


def serialize_plan(plan: InvestmentPlan) -> dict:
    metrics = plan_metrics(plan)
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    return {
        "id": plan.id,
        "investor_id": plan.investor_id,
        "investor_name": plan.investor.name if plan.investor else "",
        "principal": plan.principal,
        "plan_type": kind,
        "monthly_rate_percent": monthly_rate,
        "savings_rate_percent": savings_rate,
        "manager_fee_percent": plan.manager_fee_percent,
        "start_date": plan.start_date,
        "track_end_date": metrics["track_end_date"],
        "duration_months": plan.duration_months,
        "status": plan.status,
        "notes": plan.notes,
        "created_at": plan.created_at,
        **metrics,
    }


def serialize_payment(payment: Payment) -> dict:
    return {
        "id": payment.id,
        "plan_id": payment.plan_id,
        "investor_id": payment.investor_id,
        "investor_name": payment.investor.name if payment.investor else "",
        "month_number": payment.month_number,
        "due_date": payment.due_date,
        "investor_amount": payment.investor_amount,
        "manager_amount": payment.manager_amount,
        "status": payment.status,
        "paid_at": payment.paid_at,
        "notes": payment.notes,
    }


def serialize_investor(investor: Investor, today: Optional[date] = None) -> dict:
    today = today or date.today()
    active_plans = [p for p in investor.plans if p.status == "active"]
    active_principal = sum(p.principal for p in active_plans)
    monthly_payout = sum(
        calc_monthly(
            p.principal,
            normalize_plan_rates(
                getattr(p, "plan_type", None) or "monthly",
                p.monthly_rate_percent,
                getattr(p, "savings_rate_percent", 0.0) or 0.0,
            )[1],
        )
        for p in active_plans
    )
    if active_plans:
        earliest = min(p.start_date for p in active_plans)
        months_in = months_between(earliest, today)
    else:
        months_in = 0
    access_username = None
    access_email = None
    access_role = None
    has_login = False
    user = getattr(investor, "user", None)
    if user is not None:
        access_username = user.username
        access_email = user.email
        access_role = user.role
        has_login = bool(user.password_hash) and not user.must_reset_password
    return {
        "id": investor.id,
        "name": investor.name,
        "is_manager": investor.is_manager,
        "phone": investor.phone,
        "notes": investor.notes,
        "created_at": investor.created_at,
        "active_principal": round(active_principal, 2),
        "monthly_payout": round(monthly_payout, 2),
        "months_in_program": months_in,
        "plans_count": len(investor.plans),
        "access_username": access_username,
        "access_email": access_email,
        "access_role": access_role,
        "has_login": has_login,
    }


def quote_metrics(quote: Quote) -> dict:
    track = track_metrics(
        principal=quote.principal,
        plan_type=getattr(quote, "plan_type", None) or "monthly",
        monthly_rate_percent=quote.monthly_rate_percent,
        savings_rate_percent=getattr(quote, "savings_rate_percent", 0.0) or 0.0,
        manager_fee_percent=quote.manager_fee_percent,
        duration_months=quote.duration_months,
    )
    return {
        "monthly_investor_payout": track["monthly_investor_payout"],
        "monthly_manager_fee": track["monthly_manager_fee"],
        "monthly_savings_accrual": track["monthly_savings_accrual"],
        "projected_savings_balance": track["projected_savings_balance"],
        "total_cash_payout": track["total_cash_payout"],
        "total_investor_payout": track["total_investor_payout"],
        "total_manager_fee": track["total_manager_fee"],
        "annual_investor_payout": track["annual_investor_payout"],
    }


def serialize_quote(quote: Quote) -> dict:
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        getattr(quote, "plan_type", None) or "monthly",
        quote.monthly_rate_percent,
        getattr(quote, "savings_rate_percent", 0.0) or 0.0,
    )
    return {
        "id": quote.id,
        "prospect_name": quote.prospect_name,
        "principal": quote.principal,
        "plan_type": kind,
        "monthly_rate_percent": monthly_rate,
        "savings_rate_percent": savings_rate,
        "manager_fee_percent": quote.manager_fee_percent,
        "duration_months": quote.duration_months,
        "notes": quote.notes,
        "status": quote.status,
        "converted_investor_id": quote.converted_investor_id,
        "created_at": quote.created_at,
        **quote_metrics(quote),
    }


def _payment_priority(status: str) -> int:
    return {
        "paid": 3,
        "awaiting_confirmation": 2,
        "scheduled": 1,
        "skipped": 0,
    }.get(status, 0)


def _resolve_investor_due_conflict(
    db: Session,
    *,
    payment: Payment,
    due: date,
) -> bool:
    """Ensure this payment can own investor+due_date. Returns False if payment should be dropped."""
    others = (
        db.query(Payment)
        .filter(
            Payment.investor_id == payment.investor_id,
            Payment.due_date == due,
            Payment.id != payment.id,
        )
        .all()
    )
    if not others:
        payment.due_date = due
        return True

    for other in list(others):
        if _payment_priority(payment.status) >= _payment_priority(other.status):
            if other.status in {"paid", "awaiting_confirmation"} and _payment_priority(
                payment.status
            ) == _payment_priority(other.status):
                # Keep the existing paid/awaiting row; drop this one.
                return False
            db.delete(other)
        else:
            return False
    db.flush()
    payment.due_date = due
    return True


def month_savings_ledger(
    *,
    principal: float,
    savings_rate_percent: float,
    duration_months: int,
) -> list[dict]:
    """Per-month savings accrual with compound every 12 months."""
    rows: list[dict] = []
    if principal <= 0 or savings_rate_percent <= 0 or duration_months <= 0:
        for month in range(1, duration_months + 1):
            rows.append(
                {
                    "month_number": month,
                    "savings_accrual": 0.0,
                    "cumulative_savings": 0.0,
                    "compounded": False,
                }
            )
        return rows

    base = principal
    total_savings = 0.0
    year_bucket = 0.0
    for month in range(1, duration_months + 1):
        accrual = calc_monthly(base, savings_rate_percent)
        year_bucket = round(year_bucket + accrual, 2)
        compounded = False
        if month % 12 == 0 or month == duration_months:
            total_savings = round(total_savings + year_bucket, 2)
            base = round(principal + total_savings, 2)
            year_bucket = 0.0
            compounded = month % 12 == 0
        rows.append(
            {
                "month_number": month,
                "savings_accrual": accrual,
                "cumulative_savings": round(total_savings + year_bucket, 2),
                "compounded": compounded,
            }
        )
    return rows


def build_plan_status_report(
    plan: InvestmentPlan,
    *,
    year: Optional[int] = None,
) -> dict:
    """Full month-by-month status from plan start: cash + savings + payment status.

    If `year` is set, only months whose due date falls in that calendar year are
    returned (no months before the investor joined / outside the year).
    """
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    cash_monthly = calc_monthly(plan.principal, monthly_rate)
    manager_monthly = calc_monthly(plan.principal, plan.manager_fee_percent)
    savings_rows = {
        r["month_number"]: r
        for r in month_savings_ledger(
            principal=plan.principal,
            savings_rate_percent=savings_rate,
            duration_months=plan.duration_months,
        )
    }
    payments_by_month = {
        p.month_number: p for p in (plan.payments or []) if p.month_number
    }
    months: list[dict] = []
    cumulative_cash = 0.0
    for month in range(1, plan.duration_months + 1):
        payment = payments_by_month.get(month)
        cash = float(payment.investor_amount) if payment is not None else cash_monthly
        if kind == "savings":
            cash = 0.0 if payment is None else float(payment.investor_amount or 0)
        cumulative_cash = round(cumulative_cash + cash, 2)
        sav = savings_rows.get(month) or {
            "savings_accrual": 0.0,
            "cumulative_savings": 0.0,
            "compounded": False,
        }
        due = (
            payment.due_date
            if payment is not None and payment.due_date is not None
            else add_months(plan.start_date, month - 1)
        )
        if year is not None and due.year != year:
            continue
        months.append(
            {
                "month_number": month,
                "due_date": due,
                "cash_amount": cash,
                "manager_amount": float(payment.manager_amount)
                if payment is not None
                else manager_monthly,
                "savings_accrual": sav["savings_accrual"],
                "cumulative_cash": cumulative_cash,
                "cumulative_savings": sav["cumulative_savings"],
                "compounded": sav["compounded"],
                "status": payment.status if payment is not None else "scheduled",
                "payment_id": payment.id if payment is not None else None,
            }
        )

    paid_cash = round(
        sum(m["cash_amount"] for m in months if m["status"] == "paid"), 2
    )
    latest = next((m for m in reversed(months) if m["status"] == "paid"), None)
    current = next(
        (m for m in months if m["status"] in {"scheduled", "awaiting_confirmation"}),
        months[-1] if months else None,
    )
    return {
        "plan_id": plan.id,
        "investor_id": plan.investor_id,
        "investor_name": plan.investor.name if plan.investor else "",
        "plan_type": kind,
        "principal": plan.principal,
        "start_date": plan.start_date,
        "duration_months": plan.duration_months,
        "monthly_cash": cash_monthly,
        "monthly_savings_accrual": calc_monthly(plan.principal, savings_rate)
        if savings_rate
        else 0.0,
        "projected_savings_balance": (
            savings_rows.get(plan.duration_months, {}).get("cumulative_savings", 0.0)
            if savings_rows
            else 0.0
        ),
        "paid_cash_total": paid_cash,
        "current_savings_balance": (latest or current or {}).get("cumulative_savings", 0.0)
        if (latest or current)
        else 0.0,
        "filter_year": year,
        "months": months,
    }


def sync_payment_amounts(db: Session, plan: InvestmentPlan) -> dict:
    """Update cash amounts on existing payments without touching dates or start_date."""
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    plan.plan_type = kind
    plan.monthly_rate_percent = monthly_rate
    plan.savings_rate_percent = savings_rate
    monthly_investor = calc_monthly(plan.principal, monthly_rate)
    monthly_manager = calc_monthly(plan.principal, plan.manager_fee_percent)

    updated = 0
    payments = db.query(Payment).filter(Payment.plan_id == plan.id).all()
    for payment in payments:
        if payment.status == "skipped":
            continue
        # Keep historical paid as-is only if amounts already match; otherwise sync
        # so the client view stays consistent after rate edits.
        if (
            payment.investor_amount != monthly_investor
            or payment.manager_amount != monthly_manager
        ):
            payment.investor_amount = monthly_investor
            payment.manager_amount = monthly_manager
            updated += 1
    db.commit()
    return {
        "updated": updated,
        "monthly_investor": monthly_investor,
        "monthly_manager": monthly_manager,
    }


def generate_payment_schedule(
    db: Session,
    plan: InvestmentPlan,
    *,
    realign_dates: bool = True,
) -> list[Payment]:
    """Rebuild / fill payment months.

    When realign_dates is False (rate/principal edits), keep existing due_dates and
    only sync amounts + create missing months — never rewrite plan.start_date.
    """
    kind, monthly_rate, _savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    plan.plan_type = kind
    plan.monthly_rate_percent = monthly_rate
    plan.savings_rate_percent = _savings_rate
    monthly_investor = calc_monthly(plan.principal, monthly_rate)
    monthly_manager = calc_monthly(plan.principal, plan.manager_fee_percent)

    if not realign_dates:
        # Soft path: amounts only + fill gaps, preserve every existing due_date.
        existing = (
            db.query(Payment).filter(Payment.plan_id == plan.id).order_by(Payment.id).all()
        )
        by_month: dict[int, Payment] = {}
        for payment in existing:
            prev = by_month.get(payment.month_number)
            if prev is None:
                by_month[payment.month_number] = payment
                continue
            if _payment_priority(payment.status) > _payment_priority(prev.status):
                db.delete(prev)
                by_month[payment.month_number] = payment
            else:
                db.delete(payment)
        db.flush()

        for month, payment in list(by_month.items()):
            if month < 1 or month > plan.duration_months:
                if payment.status not in {"paid", "awaiting_confirmation"}:
                    db.delete(payment)
                    by_month.pop(month, None)
                continue
            payment.investor_id = plan.investor_id
            if payment.status != "skipped":
                payment.investor_amount = monthly_investor
                payment.manager_amount = monthly_manager

        # Drop out-of-range unpaid after loop cleanup
        for payment in db.query(Payment).filter(Payment.plan_id == plan.id).all():
            if payment.month_number < 1 or payment.month_number > plan.duration_months:
                if payment.status not in {"paid", "awaiting_confirmation"}:
                    db.delete(payment)
        db.flush()

        by_month = {
            p.month_number: p
            for p in db.query(Payment).filter(Payment.plan_id == plan.id).all()
        }
        created: list[Payment] = []
        for month in range(1, plan.duration_months + 1):
            if month in by_month:
                continue
            due = add_months(plan.start_date, month - 1)
            clash = (
                db.query(Payment)
                .filter(
                    Payment.investor_id == plan.investor_id,
                    Payment.due_date == due,
                )
                .first()
            )
            if clash is not None:
                continue
            payment = Payment(
                plan_id=plan.id,
                investor_id=plan.investor_id,
                month_number=month,
                due_date=due,
                investor_amount=monthly_investor,
                manager_amount=monthly_manager,
                status="scheduled",
            )
            db.add(payment)
            created.append(payment)
        db.commit()
        return created

    existing = (
        db.query(Payment).filter(Payment.plan_id == plan.id).order_by(Payment.id).all()
    )

    # Keep at most one preserved row per month_number (prefer paid/awaiting).
    preserved: dict[int, Payment] = {}
    for payment in existing:
        prev = preserved.get(payment.month_number)
        if prev is None:
            preserved[payment.month_number] = payment
            continue
        if _payment_priority(payment.status) > _payment_priority(prev.status):
            db.delete(prev)
            preserved[payment.month_number] = payment
        else:
            db.delete(payment)
    db.flush()

    # Drop non-preserved / out-of-range unpaid rows first so due_date moves cannot clash
    # with stale scheduled rows on the same plan.
    keep_ids = {p.id for p in preserved.values()}
    for payment in (
        db.query(Payment).filter(Payment.plan_id == plan.id).all()
    ):
        in_range = 1 <= payment.month_number <= plan.duration_months
        if payment.id in keep_ids and in_range and payment.status in {
            "paid",
            "awaiting_confirmation",
        }:
            continue
        if payment.status in {"paid", "awaiting_confirmation"} and in_range:
            continue
        if payment.id in keep_ids and payment.status in {"paid", "awaiting_confirmation"}:
            # out of range paid — keep but don't block regeneration
            continue
        db.delete(payment)
    db.flush()

    # Re-read preserved paid/awaiting after deletes.
    preserved = {
        p.month_number: p
        for p in db.query(Payment)
        .filter(
            Payment.plan_id == plan.id,
            Payment.status.in_(("paid", "awaiting_confirmation")),
        )
        .all()
    }

    # Move preserved dues first.
    for month, payment in list(preserved.items()):
        if month < 1 or month > plan.duration_months:
            continue
        due = add_months(plan.start_date, month - 1)
        payment.investor_id = plan.investor_id
        if not _resolve_investor_due_conflict(db, payment=payment, due=due):
            # Conflict with a stronger row on another plan — drop this preserved row
            # only if it somehow lost priority (should be rare).
            db.delete(payment)
            preserved.pop(month, None)
    db.flush()

    created = []
    for month in range(1, plan.duration_months + 1):
        if month in preserved:
            continue
        due = add_months(plan.start_date, month - 1)
        clash = (
            db.query(Payment)
            .filter(
                Payment.investor_id == plan.investor_id,
                Payment.due_date == due,
            )
            .first()
        )
        if clash is not None:
            continue
        payment = Payment(
            plan_id=plan.id,
            investor_id=plan.investor_id,
            month_number=month,
            due_date=due,
            investor_amount=monthly_investor,
            manager_amount=monthly_manager,
            status="scheduled",
        )
        db.add(payment)
        created.append(payment)

    db.commit()
    return created


def dedupe_all_payments(db: Session) -> dict:
    """Remove duplicate payments by plan-month and by investor-due_date."""
    removed = 0

    # plan_id + month_number
    plans = db.query(InvestmentPlan.id).all()
    for (plan_id,) in plans:
        rows = (
            db.query(Payment)
            .filter(Payment.plan_id == plan_id)
            .order_by(Payment.month_number.asc(), Payment.id.asc())
            .all()
        )
        seen_month: dict[int, Payment] = {}
        for payment in rows:
            prior = seen_month.get(payment.month_number)
            if prior is None:
                seen_month[payment.month_number] = payment
                continue
            if _payment_priority(payment.status) > _payment_priority(prior.status):
                db.delete(prior)
                seen_month[payment.month_number] = payment
            else:
                db.delete(payment)
            removed += 1
    db.flush()

    # investor_id + due_date (across plans)
    rows = db.query(Payment).order_by(Payment.investor_id.asc(), Payment.due_date.asc(), Payment.id.asc()).all()
    seen_due: dict[tuple[int, date], Payment] = {}
    for payment in rows:
        key = (payment.investor_id, payment.due_date)
        prior = seen_due.get(key)
        if prior is None:
            seen_due[key] = payment
            continue
        if _payment_priority(payment.status) > _payment_priority(prior.status):
            db.delete(prior)
            seen_due[key] = payment
        else:
            db.delete(payment)
        removed += 1
    db.commit()
    return {"removed": removed}


def repair_duplicate_payments(db: Session) -> dict:
    """Backward-compatible alias used by reporting-year repair."""
    return dedupe_all_payments(db)


def repair_reporting_year_plans(db: Session) -> dict:
    """Startup safety: remove payment duplicates and restore mid-year track lengths.

    Never rewrite client start_dates to January — only ensure reporting boards
    keep full track duration from plan terms (not truncated to December).
    """
    dupes = dedupe_all_payments(db)
    restored = restore_midyear_reporting_plan_durations(db)
    return {
        "duplicate_payments_removed": dupes["removed"],
        "plans_realigned": 0,
        "active_starts_fixed": 0,
        "reporting_plans_clipped": 0,
        "reporting_plans_restored": restored["restored"],
    }


def calendar_year_start(value: date) -> date:
    return date(value.year, 1, 1)


def align_plans_to_calendar_year(
    db: Session, *, year: Optional[int] = None
) -> dict:
    """Move plan start dates to 1 Jan of their year and rebuild schedules.

    Keeps paid rows (by month_number) and rewrites their due dates to the
    calendar-aligned schedule so yearly reports cover Jan–Dec.
    """
    query = db.query(InvestmentPlan).filter(InvestmentPlan.status == "active")
    plans = query.all()
    aligned: list[dict] = []

    for plan in plans:
        target_year = year if year is not None else plan.start_date.year
        if year is not None and plan.start_date.year != year:
            # Only touch plans that already belong to the requested calendar year
            # or currently spill from a mid-year open into that year.
            has_year_payment = (
                db.query(Payment)
                .filter(
                    Payment.plan_id == plan.id,
                    Payment.due_date >= date(year, 1, 1),
                    Payment.due_date <= date(year, 12, 31),
                )
                .first()
                is not None
            )
            if plan.start_date.year != year and not has_year_payment:
                continue
            target_year = year

        new_start = date(target_year, 1, 1)
        if plan.start_date == new_start:
            # Still refresh paid due dates if they drifted.
            paid = (
                db.query(Payment)
                .filter(Payment.plan_id == plan.id, Payment.status == "paid")
                .all()
            )
            changed = False
            for payment in paid:
                expected = add_months(new_start, payment.month_number - 1)
                if payment.due_date != expected:
                    payment.due_date = expected
                    changed = True
            if changed:
                db.commit()
                generate_payment_schedule(db, plan)
                aligned.append(
                    {
                        "plan_id": plan.id,
                        "investor_id": plan.investor_id,
                        "start_date": new_start.isoformat(),
                        "action": "refreshed",
                    }
                )
            continue

        old_start = plan.start_date
        plan.start_date = new_start
        paid = (
            db.query(Payment)
            .filter(Payment.plan_id == plan.id, Payment.status == "paid")
            .all()
        )
        for payment in paid:
            payment.due_date = add_months(new_start, payment.month_number - 1)
        db.commit()
        generate_payment_schedule(db, plan)
        aligned.append(
            {
                "plan_id": plan.id,
                "investor_id": plan.investor_id,
                "from": old_start.isoformat(),
                "start_date": new_start.isoformat(),
                "action": "aligned",
            }
        )

    return {"aligned": aligned, "count": len(aligned)}


def _payment_totals(payments: list[Payment]) -> dict:
    paid = [p for p in payments if p.status == "paid"]
    scheduled = [p for p in payments if p.status == "scheduled"]
    awaiting = [p for p in payments if p.status == "awaiting_confirmation"]
    skipped = [p for p in payments if p.status == "skipped"]
    return {
        "planned_investor": round(sum(p.investor_amount for p in payments), 2),
        "paid_investor": round(sum(p.investor_amount for p in paid), 2),
        "planned_manager": round(sum(p.manager_amount for p in payments), 2),
        "paid_manager": round(sum(p.manager_amount for p in paid), 2),
        "paid_count": len(paid),
        "scheduled_count": len(scheduled),
        "awaiting_count": len(awaiting),
        "skipped_count": len(skipped),
        "total_count": len(payments),
        "savings_to_date": 0.0,
        "savings_to_track_end": 0.0,
    }


def _plans_for_savings_summary(
    db: Session, *, investor_id: Optional[int] = None
) -> list[InvestmentPlan]:
    """Active plans preferred; if none for an investor, fall back to latest completed."""
    query = db.query(InvestmentPlan).options(
        joinedload(InvestmentPlan.investor),
        joinedload(InvestmentPlan.payments),
    )
    if investor_id is not None:
        query = query.filter(InvestmentPlan.investor_id == investor_id)
    plans = query.order_by(InvestmentPlan.id).all()
    by_investor: dict[int, list[InvestmentPlan]] = {}
    for plan in plans:
        by_investor.setdefault(plan.investor_id, []).append(plan)

    chosen: list[InvestmentPlan] = []
    for inv_plans in by_investor.values():
        active = [p for p in inv_plans if p.status == "active"]
        if active:
            chosen.extend(active)
            continue
        # Latest by start_date for completed-only investors
        inv_plans_sorted = sorted(
            inv_plans,
            key=lambda p: (p.start_date or date.min, p.id),
            reverse=True,
        )
        if inv_plans_sorted:
            chosen.append(inv_plans_sorted[0])
    return chosen


def _savings_totals_for_plans(plans: list[InvestmentPlan]) -> dict:
    to_date = 0.0
    to_end = 0.0
    for plan in plans:
        metrics = plan_metrics(plan)
        to_date = round(to_date + float(metrics["current_savings_balance"] or 0), 2)
        to_end = round(to_end + float(metrics["projected_savings_balance"] or 0), 2)
    return {
        "savings_to_date": to_date,
        "savings_to_track_end": to_end,
    }


def available_payment_years(
    db: Session, *, investor_id: Optional[int] = None
) -> list[int]:
    query = db.query(Payment.due_date)
    if investor_id is not None:
        query = query.filter(Payment.investor_id == investor_id)
    years = {row[0].year for row in query.all() if row[0] is not None}
    today_year = date.today().year
    years.update({today_year, today_year - 1, today_year - 2})
    return sorted(years, reverse=True)


def get_payment_report(
    db: Session, *, year: int, investor_id: Optional[int] = None
) -> dict:
    base = db.query(Payment)
    if investor_id is not None:
        base = base.filter(Payment.investor_id == investor_id)

    lifetime = base.all()
    yearly = [
        p
        for p in lifetime
        if p.due_date is not None and p.due_date.year == year
    ]
    lifetime_totals = _payment_totals(lifetime)
    yearly_totals = _payment_totals(yearly)
    savings = _savings_totals_for_plans(
        _plans_for_savings_summary(db, investor_id=investor_id)
    )
    lifetime_totals.update(savings)
    return {
        "year": year,
        "available_years": available_payment_years(db, investor_id=investor_id),
        "yearly": yearly_totals,
        "lifetime": lifetime_totals,
    }


def months_through_december(start: date) -> int:
    """How many calendar months from start (inclusive) until December of that year."""
    return max(1, 12 - start.month + 1)


def clip_plan_to_calendar_year(db: Session, plan: InvestmentPlan, year: int) -> bool:
    """No-op: tracks follow plan duration, not calendar-year truncation."""
    del db, plan, year
    return False


def restore_midyear_reporting_plan_durations(db: Session) -> dict:
    """Restore 'לוח דיווח' plans truncated to Dec back to full track length.

    Uses the investor's active (or latest) plan duration as the track terms.
    Keeps the actual start_date — never invents months before the investor joined.
    """
    import re

    restored = 0
    plans = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor))
        .all()
    )
    by_investor: dict[int, list[InvestmentPlan]] = {}
    for plan in plans:
        by_investor.setdefault(plan.investor_id, []).append(plan)

    for plan in plans:
        notes = plan.notes or ""
        match = re.search(r"לוח דיווח לשנת (\d{4})", notes)
        if not match or not plan.start_date:
            continue
        year = int(match.group(1))
        if plan.start_date.year != year:
            continue
        siblings = by_investor.get(plan.investor_id, [])
        template = next(
            (p for p in siblings if p.status == "active" and p.id != plan.id),
            None,
        )
        if template is None:
            others = [p for p in siblings if p.id != plan.id]
            others = sorted(
                others,
                key=lambda p: (p.start_date or date.min, p.id),
                reverse=True,
            )
            template = others[0] if others else None
        target_duration = (
            template.duration_months if template is not None else plan.duration_months
        )
        # At least cover through December of the reporting year, but prefer full track.
        min_for_year = months_through_december(plan.start_date)
        target_duration = max(int(target_duration or 0), min_for_year)
        if plan.duration_months >= target_duration:
            continue
        plan.duration_months = target_duration
        db.commit()
        generate_payment_schedule(db, plan, realign_dates=False)
        restored += 1
    return {"restored": restored}


def repair_midyear_reporting_plans(db: Session) -> dict:
    """Compatibility alias — restores full track durations instead of clipping."""
    result = restore_midyear_reporting_plan_durations(db)
    return {"clipped": 0, "restored": result["restored"]}


def open_calendar_year_plans(db: Session, *, year: int) -> dict:
    """Create a reporting-year plan covering the investor's track terms.

    If their start is mid-year, the board starts that month — never backfills
    January–prior months. Duration follows the template track (not truncated to Dec).
    """
    if year < 2000 or year > date.today().year + 1:
        raise ValueError("שנה לא תקינה")

    investors = db.query(Investor).options(joinedload(Investor.plans)).order_by(Investor.id).all()
    created: list[dict] = []
    skipped: list[dict] = []
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    plan_status = "completed" if year < date.today().year else "active"

    for investor in investors:
        plans = sorted(
            investor.plans,
            key=lambda p: (p.start_date or date.min, p.id),
            reverse=True,
        )
        if not plans:
            skipped.append({"investor_id": investor.id, "reason": "no_plan"})
            continue

        has_plan_in_year = any(p.start_date and p.start_date.year == year for p in plans)
        has_payment_in_year = (
            db.query(Payment)
            .filter(
                Payment.investor_id == investor.id,
                Payment.due_date >= year_start,
                Payment.due_date <= year_end,
            )
            .first()
            is not None
        )
        if has_plan_in_year or has_payment_in_year:
            skipped.append({"investor_id": investor.id, "reason": "already_exists"})
            continue

        template = next((p for p in plans if p.status == "active"), plans[0])
        # Start from actual entry month in this year when known; otherwise Jan 1.
        if template.start_date and template.start_date.year == year:
            start = template.start_date
        elif template.start_date and template.start_date.year < year:
            start = year_start
        else:
            start = year_start
        if start < year_start:
            start = year_start
        if start > year_end:
            skipped.append({"investor_id": investor.id, "reason": "starts_after_year"})
            continue
        duration = max(int(template.duration_months or 12), 1)

        plan = InvestmentPlan(
            investor_id=investor.id,
            principal=template.principal,
            plan_type=getattr(template, "plan_type", None) or "monthly",
            monthly_rate_percent=template.monthly_rate_percent,
            savings_rate_percent=getattr(template, "savings_rate_percent", 0.0) or 0.0,
            manager_fee_percent=template.manager_fee_percent,
            start_date=start,
            duration_months=duration,
            status=plan_status,
            notes=f"לוח דיווח לשנת {year}",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        generate_payment_schedule(db, plan, realign_dates=True)
        created.append(
            {
                "plan_id": plan.id,
                "investor_id": investor.id,
                "start_date": start.isoformat(),
                "track_end_date": plan_track_end_date(plan).isoformat(),
                "duration_months": duration,
                "status": plan_status,
            }
        )

    return {
        "year": year,
        "created": created,
        "created_count": len(created),
        "skipped": skipped,
        "skipped_count": len(skipped),
    }


def remove_investor_from_calendar_year(
    db: Session, *, year: int, investor_id: int
) -> dict:
    """Delete plans that belong to a calendar reporting year for one investor.

    Removes the Jan–Dec plan(s) for that year and their payments so the investor
    no longer appears in the yearly report.
    """
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    plans = (
        db.query(InvestmentPlan)
        .filter(
            InvestmentPlan.investor_id == investor_id,
            InvestmentPlan.start_date >= year_start,
            InvestmentPlan.start_date <= year_end,
        )
        .all()
    )
    deleted_ids = [p.id for p in plans]
    for plan in plans:
        db.delete(plan)
    db.commit()
    return {
        "year": year,
        "investor_id": investor_id,
        "deleted_plan_ids": deleted_ids,
        "deleted_count": len(deleted_ids),
    }


def mark_year_payments_paid(
    db: Session,
    *,
    year: int,
    investor_id: Optional[int] = None,
    actor=None,
) -> dict:
    """Ask for investor confirmation on all scheduled payments in a calendar year."""
    query = db.query(Payment).options(joinedload(Payment.investor)).filter(
        Payment.due_date >= date(year, 1, 1),
        Payment.due_date <= date(year, 12, 31),
        Payment.status == "scheduled",
    )
    if investor_id is not None:
        query = query.filter(Payment.investor_id == investor_id)
    payments = query.all()
    requested = 0
    auto_paid = 0
    for payment in payments:
        result = request_payment_confirmation(
            db, payment=payment, actor=actor, commit=False
        )
        if result["status"] == "paid":
            auto_paid += 1
        else:
            requested += 1
    db.commit()
    return {
        "year": year,
        "marked_count": requested + auto_paid,
        "awaiting_count": requested,
        "auto_paid_count": auto_paid,
    }


def _investor_user(db: Session, investor_id: int):
    from app.models.auth import User

    return db.query(User).filter(User.investor_id == investor_id).first()


def _notify_payment_confirmation_request(db: Session, payment: Payment) -> None:
    from app.services.email_service import send_email

    user = _investor_user(db, payment.investor_id)
    if not user or not user.email:
        return
    name = payment.investor.name if payment.investor else user.username
    month = payment.due_date.strftime("%m/%Y") if payment.due_date else ""
    send_email(
        db,
        to_email=user.email,
        subject=f"תזרים — נדרש אישור תשלום ל-{name}",
        body=(
            f"שלום {name},\n\n"
            f"המנהל סימן תשלום לחודש {month} בסך {payment.investor_amount:,.2f} ₪.\n"
            "יש להיכנס לתזרים → תשלומים ולאשר או לדחות את קבלת התשלום.\n"
            "רק אחרי אישור הסטטוס ישתנה לבוצע.\n"
        ),
        kind="payment_awaiting_confirmation",
        meta={"payment_id": payment.id, "investor_id": payment.investor_id},
    )


def _notify_payment_confirmed(db: Session, payment: Payment) -> None:
    from app.models.auth import User
    from app.services.email_service import send_email

    managers = db.query(User).filter(User.role == "manager", User.is_active.is_(True)).all()
    name = payment.investor.name if payment.investor else ""
    month = payment.due_date.strftime("%m/%Y") if payment.due_date else ""
    for manager in managers:
        if not manager.email:
            continue
        send_email(
            db,
            to_email=manager.email,
            subject=f"תזרים — {name} אישר תשלום",
            body=(
                f"{name} אישר קבלת תשלום לחודש {month} "
                f"בסך {payment.investor_amount:,.2f} ₪.\n"
                "הסטטוס עודכן לבוצע.\n"
            ),
            kind="payment_confirmed",
            meta={"payment_id": payment.id, "investor_id": payment.investor_id},
        )


def request_payment_confirmation(
    db: Session,
    *,
    payment: Payment,
    actor=None,
    commit: bool = True,
) -> dict:
    """Manager asserts a payment was sent — investor must confirm before it is paid.

    If the actor is marking their own investor row, auto-confirm to בוצע.
    """
    if payment.status == "paid":
        return {"status": "paid", "payment_id": payment.id, "notified": False}

    same_person = (
        actor is not None
        and getattr(actor, "investor_id", None) is not None
        and actor.investor_id == payment.investor_id
    )
    if same_person:
        payment.status = "paid"
        payment.paid_at = date.today()
        if commit:
            db.commit()
        return {
            "status": "paid",
            "payment_id": payment.id,
            "notified": False,
            "auto": True,
        }

    payment.status = "awaiting_confirmation"
    payment.paid_at = None
    _notify_payment_confirmation_request(db, payment)
    if commit:
        db.commit()
    return {
        "status": "awaiting_confirmation",
        "payment_id": payment.id,
        "notified": True,
    }


def confirm_payment(db: Session, *, payment: Payment, actor) -> dict:
    if payment.investor_id != actor.investor_id:
        raise PermissionError("ניתן לאשר רק תשלומים שלך")
    if payment.status != "awaiting_confirmation":
        raise ValueError("אין בקשת אישור ממתין לתשלום זה")
    payment.status = "paid"
    payment.paid_at = date.today()
    _notify_payment_confirmed(db, payment)
    db.commit()
    return {"status": "paid", "payment_id": payment.id}


def reject_payment_confirmation(db: Session, *, payment: Payment, actor) -> dict:
    is_owner = payment.investor_id == actor.investor_id
    actor_is_manager = getattr(actor, "role", None) == "manager"
    if not actor_is_manager:
        inv = getattr(actor, "investor", None)
        actor_is_manager = bool(inv and getattr(inv, "is_manager", False))
    if not is_owner and not actor_is_manager:
        raise PermissionError("אין הרשאה")
    if payment.status != "awaiting_confirmation":
        raise ValueError("אין בקשת אישור ממתין לתשלום זה")
    payment.status = "scheduled"
    payment.paid_at = None
    db.commit()
    return {"status": "scheduled", "payment_id": payment.id}


def get_dashboard(db: Session, *, investor_id: Optional[int] = None) -> dict:
    today = date.today()
    investors_query = db.query(Investor).options(joinedload(Investor.plans)).order_by(Investor.id)
    if investor_id is not None:
        investors_query = investors_query.filter(Investor.id == investor_id)
    investors = investors_query.all()

    plans_query = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.status == "active")
    )
    if investor_id is not None:
        plans_query = plans_query.filter(InvestmentPlan.investor_id == investor_id)
    plans = plans_query.all()

    total_principal = 0.0
    monthly_investor = 0.0
    monthly_manager_fees = 0.0
    monthly_manager_own = 0.0

    for plan in plans:
        total_principal += plan.principal
        payout = calc_monthly(plan.principal, plan.monthly_rate_percent)
        fee = calc_monthly(plan.principal, plan.manager_fee_percent)
        monthly_investor += payout
        monthly_manager_fees += fee
        if plan.investor and plan.investor.is_manager:
            monthly_manager_own += payout

    year_start = date(today.year, 1, 1)
    paid_query = db.query(Payment).filter(
        Payment.status == "paid", Payment.paid_at >= year_start
    )
    if investor_id is not None:
        paid_query = paid_query.filter(Payment.investor_id == investor_id)
    paid_year = paid_query.all()
    ytd_investor = sum(p.investor_amount for p in paid_year)
    ytd_manager = sum(p.manager_amount for p in paid_year)

    lifetime_query = db.query(Payment).filter(Payment.status == "paid")
    if investor_id is not None:
        lifetime_query = lifetime_query.filter(Payment.investor_id == investor_id)
    paid_lifetime = lifetime_query.all()
    lifetime_investor = sum(p.investor_amount for p in paid_lifetime)
    lifetime_manager = sum(p.manager_amount for p in paid_lifetime)

    upcoming_query = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.status == "scheduled")
    )
    if investor_id is not None:
        upcoming_query = upcoming_query.filter(Payment.investor_id == investor_id)
    upcoming = upcoming_query.order_by(Payment.due_date.asc()).limit(8).all()

    recent_query = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.status == "paid")
    )
    if investor_id is not None:
        recent_query = recent_query.filter(Payment.investor_id == investor_id)
    recent = recent_query.order_by(Payment.paid_at.desc(), Payment.id.desc()).limit(8).all()

    return {
        "total_principal": round(total_principal, 2),
        "monthly_investor_payouts": round(monthly_investor, 2),
        "monthly_manager_fees": round(monthly_manager_fees, 2),
        "monthly_manager_own_payout": round(monthly_manager_own, 2),
        "monthly_manager_total": round(monthly_manager_own + monthly_manager_fees, 2),
        "ytd_investor_paid": round(ytd_investor, 2),
        "ytd_manager_earned": round(ytd_manager, 2),
        "lifetime_investor_paid": round(lifetime_investor, 2),
        "lifetime_manager_earned": round(lifetime_manager, 2),
        "active_investors": len([i for i in investors if not i.is_manager and i.plans]),
        "active_plans": len(plans),
        "upcoming_payments": [serialize_payment(p) for p in upcoming],
        "recent_payments": [serialize_payment(p) for p in recent],
        "investors_summary": [serialize_investor(i, today) for i in investors],
    }
