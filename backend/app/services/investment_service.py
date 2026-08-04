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
            if is_manager_flag and "מנהלת" in existing:
                legacy = db.query(Investor).filter(Investor.name == "מנהלת", Investor.is_manager.is_(True)).first()
                if legacy:
                    legacy.name = name
                    created.append(f"renamed:מנהלת->{name}")
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


def plan_metrics(plan: InvestmentPlan, today: Optional[date] = None) -> dict:
    today = today or date.today()
    monthly_investor = calc_monthly(plan.principal, plan.monthly_rate_percent)
    monthly_manager = calc_monthly(plan.principal, plan.manager_fee_percent)
    elapsed = min(months_between(plan.start_date, today), plan.duration_months)
    remaining = max(plan.duration_months - elapsed, 0)
    payments = plan.payments or []
    paid = [p for p in payments if p.status == "paid"]
    return {
        "monthly_investor_payout": monthly_investor,
        "monthly_manager_fee": monthly_manager,
        "total_investor_payout": round(monthly_investor * plan.duration_months, 2),
        "total_manager_fee": round(monthly_manager * plan.duration_months, 2),
        "annual_investor_payout": round(monthly_investor * 12, 2),
        "months_elapsed": elapsed,
        "months_remaining": remaining,
        "paid_count": len(paid),
        "paid_investor_total": round(sum(p.investor_amount for p in paid), 2),
        "paid_manager_total": round(sum(p.manager_amount for p in paid), 2),
    }


def serialize_plan(plan: InvestmentPlan) -> dict:
    metrics = plan_metrics(plan)
    return {
        "id": plan.id,
        "investor_id": plan.investor_id,
        "investor_name": plan.investor.name if plan.investor else "",
        "principal": plan.principal,
        "monthly_rate_percent": plan.monthly_rate_percent,
        "manager_fee_percent": plan.manager_fee_percent,
        "start_date": plan.start_date,
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
        calc_monthly(p.principal, p.monthly_rate_percent) for p in active_plans
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
    monthly_investor = calc_monthly(quote.principal, quote.monthly_rate_percent)
    monthly_manager = calc_monthly(quote.principal, quote.manager_fee_percent)
    return {
        "monthly_investor_payout": monthly_investor,
        "monthly_manager_fee": monthly_manager,
        "total_investor_payout": round(monthly_investor * quote.duration_months, 2),
        "total_manager_fee": round(monthly_manager * quote.duration_months, 2),
        "annual_investor_payout": round(monthly_investor * 12, 2),
    }


def serialize_quote(quote: Quote) -> dict:
    return {
        "id": quote.id,
        "prospect_name": quote.prospect_name,
        "principal": quote.principal,
        "monthly_rate_percent": quote.monthly_rate_percent,
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


def generate_payment_schedule(db: Session, plan: InvestmentPlan) -> list[Payment]:
    """Rebuild unpaid months and keep paid months in sync with start_date.

    Enforces one payment per plan month and one payment per investor due_date
    so the same person cannot appear twice on the same calendar day.
    """
    monthly_investor = calc_monthly(plan.principal, plan.monthly_rate_percent)
    monthly_manager = calc_monthly(plan.principal, plan.manager_fee_percent)

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

    created: list[Payment] = []
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
    """Realign reporting plans, fix drifted starts, and remove all payment duplicates."""
    import re
    from collections import Counter

    dupes = dedupe_all_payments(db)
    realigned = 0
    fixed_active = 0

    # Fix active plans whose start_date year drifted away from their payment years
    # (e.g. start=2025-09 but payments live in 2026) — prevents year overlaps/duplicates.
    for plan in db.query(InvestmentPlan).filter(InvestmentPlan.status == "active").all():
        dues = [
            p.due_date.year
            for p in db.query(Payment).filter(Payment.plan_id == plan.id).all()
            if p.due_date is not None
        ]
        if not dues:
            continue
        years = set(dues)
        # Only rewrite when start year has no payments at all (drifted / wrong year).
        if plan.start_date.year in years:
            continue
        target_year = min(years)
        plan.start_date = date(target_year, 1, 1)
        db.commit()
        generate_payment_schedule(db, plan)
        fixed_active += 1

    for plan in db.query(InvestmentPlan).all():
        notes = plan.notes or ""
        match = re.search(r"לוח דיווח לשנת (\d{4})", notes)
        if not match:
            continue
        year = int(match.group(1))
        expected = date(year, 1, 1)
        if plan.start_date != expected or plan.duration_months != 12:
            plan.start_date = expected
            plan.duration_months = 12
            db.commit()
            realigned += 1
        generate_payment_schedule(db, plan)

    dupes2 = dedupe_all_payments(db)
    return {
        "duplicate_payments_removed": dupes["removed"] + dupes2["removed"],
        "plans_realigned": realigned,
        "active_starts_fixed": fixed_active,
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
    return {
        "year": year,
        "available_years": available_payment_years(db, investor_id=investor_id),
        "yearly": _payment_totals(yearly),
        "lifetime": _payment_totals(lifetime),
    }


def open_calendar_year_plans(db: Session, *, year: int) -> dict:
    """Create Jan–Dec plans for a past/reporting year from each investor's latest plan.

    Past years are marked completed so active principal on the dashboard is not doubled.
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
        plan = InvestmentPlan(
            investor_id=investor.id,
            principal=template.principal,
            monthly_rate_percent=template.monthly_rate_percent,
            manager_fee_percent=template.manager_fee_percent,
            start_date=year_start,
            duration_months=12,
            status=plan_status,
            notes=f"לוח דיווח לשנת {year}",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        generate_payment_schedule(db, plan)
        created.append(
            {
                "plan_id": plan.id,
                "investor_id": investor.id,
                "start_date": year_start.isoformat(),
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
            f"המנהלת סימנה תשלום לחודש {month} בסך {payment.investor_amount:,.2f} ₪.\n"
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
            subject=f"תזרים — {name} אישר/ה תשלום",
            body=(
                f"{name} אישר/ה קבלת תשלום לחודש {month} "
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
        raise ValueError("אין בקשת אישור ממתינה לתשלום זה")
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
        raise ValueError("אין בקשת אישור ממתינה לתשלום זה")
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
