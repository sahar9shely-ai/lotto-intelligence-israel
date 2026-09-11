from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from app.models.investments import (
    AppSettings,
    Investor,
    InvestmentPlan,
    InvestmentTopupRequest,
    Payment,
    Quote,
    SavingsAction,
    utcnow,
)

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
# Sunday–Thursday (Python weekday: Mon=0 … Sun=6).
ISRAEL_BUSINESS_WEEKDAYS = {6, 0, 1, 2, 3}
TOPUP_COOLING_OFF_BUSINESS_DAYS = 3
MANAGER_FEE_KEYS = (
    "manager_fee_percent",
    "monthly_manager_fee",
    "total_manager_fee",
    "paid_manager_total",
)

QUOTE_STATUSES = frozenset({"pending", "approved", "converted", "rejected"})
OPEN_QUOTE_STATUSES = frozenset({"pending", "approved", "converted"})
_LEGACY_QUOTE_STATUS = {"draft": "pending", "sent": "pending", "archived": "rejected"}


def normalize_quote_status(status: Optional[str]) -> str:
    raw = (status or "pending").strip().lower()
    return _LEGACY_QUOTE_STATUS.get(raw, raw)


def validate_quote_status_transition(current: str, new: str) -> None:
    old = normalize_quote_status(current)
    target = normalize_quote_status(new)
    if target not in QUOTE_STATUSES:
        raise ValueError("סטטוס הצעה לא תקין")
    if old == target:
        return
    allowed: dict[str, set[str]] = {
        "pending": {"approved", "rejected"},
        "approved": {"pending", "rejected"},
        "converted": set(),
        "rejected": {"pending"},
    }
    if target not in allowed.get(old, set()):
        raise ValueError(f"לא ניתן לעבור מ-{old} ל-{target}")


def quote_is_editable(status: str) -> bool:
    normalized = normalize_quote_status(status)
    return normalized in {"pending", "approved"}


def months_between(start: date, end: date) -> int:
    if end < start:
        return 0
    return (end.year - start.year) * 12 + (end.month - start.month)


def add_months(start: date, months: int) -> date:
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    day = min(start.day, monthrange(year, month)[1])
    return date(year, month, day)


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def is_israel_business_day(day: date) -> bool:
    return day.weekday() in ISRAEL_BUSINESS_WEEKDAYS


def add_israel_business_days(start: date, count: int) -> date:
    """Advance `count` Israeli business days after `start` (start itself is not counted)."""
    if count <= 0:
        return start
    day = start
    remaining = count
    while remaining:
        day += timedelta(days=1)
        if is_israel_business_day(day):
            remaining -= 1
    return day


def cooling_off_deadline_utc(approved_at: datetime, *, business_days: int = TOPUP_COOLING_OFF_BUSINESS_DAYS) -> datetime:
    """End of the Nth Israeli business day after approval, stored as naive UTC."""
    local = _as_utc(approved_at).astimezone(ISRAEL_TZ)
    end_date = add_israel_business_days(local.date(), business_days)
    end_local = datetime.combine(end_date, time(23, 59, 59), tzinfo=ISRAEL_TZ)
    return end_local.astimezone(timezone.utc).replace(tzinfo=None)


def israel_business_days_remaining(until: datetime, *, now: Optional[datetime] = None) -> int:
    """Business days left in the cooling-off window.

    Counts days *after today* through the deadline, so approval day shows 3
    (the promised window) rather than 4. On the last business day returns 1
    while the window is still open.
    """
    now_utc = _as_utc(now or datetime.now(timezone.utc))
    until_utc = _as_utc(until)
    if now_utc > until_utc:
        return 0
    now_local = now_utc.astimezone(ISRAEL_TZ).date()
    end_local = until_utc.astimezone(ISRAEL_TZ).date()
    remaining = 0
    day = now_local + timedelta(days=1)
    while day <= end_local:
        if is_israel_business_day(day):
            remaining += 1
        day += timedelta(days=1)
    return remaining if remaining > 0 else 1


def redact_manager_fees(payload: dict) -> dict:
    out = dict(payload)
    for key in MANAGER_FEE_KEYS:
        out.pop(key, None)
    return out


def months_elapsed_inclusive(start: date, today: date, *, cap: int) -> int:
    """Count due months from start through today (inclusive), capped at track length.

    Example: start=2026-01-01, today=2026-08-07 → 8 (Jan…Aug), not 7.
    """
    if cap <= 0 or today < start:
        return 0
    diff = months_between(start, today)
    due_for_month = add_months(start, diff)
    elapsed = diff + 1 if today >= due_for_month else diff
    return min(max(elapsed, 0), cap)


def reporting_year_from_notes(notes: Optional[str]) -> Optional[int]:
    import re

    match = re.search(r"לוח דיווח לשנת (\d{4})", notes or "")
    return int(match.group(1)) if match else None


def plan_effective_duration(plan: InvestmentPlan) -> int:
    """Months this plan may accrue — payment span + no overlap past reporting Dec.

    'לוח דיווח לשנת YYYY' boards that started mid-year must stop in December of
    that year. Otherwise a 2025 board with duration=12 keeps accruing into 2026
    and double-counts savings against the next active plan (~₪1,100 twice).
    """
    stored = max(int(plan.duration_months or 0), 0)
    payments = list(plan.payments or [])
    schedule_len = 0
    if payments:
        schedule_len = max((p.month_number or 0) for p in payments)

    year = reporting_year_from_notes(getattr(plan, "notes", None))
    if year and plan.start_date and plan.start_date.year == year:
        year_span = months_through_december(plan.start_date)
        if schedule_len > 0:
            return max(1, min(schedule_len, year_span))
        return max(1, min(stored or year_span, year_span))

    if plan.status == "completed" and schedule_len > 0:
        return max(1, schedule_len)

    return max(stored, schedule_len, 0)


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


DEMO_INVESTOR_NAMES = ("בר", "אופק", "אלמוג", "שושי")
SYSTEM_INVESTOR_NAMES = frozenset({"מנהל מערכת", "סהר", "מנהל", "מנהלת"})


def seed_defaults(db: Session) -> dict:
    """Seed investors + users. Idempotent; safe on legacy DBs with a combined manager row.

    Demo investors (בר/אופק/…) are created only on first bootstrap. After that they are
    never recreated — deleting a user stays deleted across restarts/deploys.
    """
    from app.services.auth_service import ADMIN_INVESTOR_NAME, PERSONAL_INVESTOR_NAME

    settings = ensure_settings(db)
    created: list[str] = []
    updated: list[str] = []

    def investor_names() -> set[str]:
        return {i.name for i in db.query(Investor).all()}

    # 1) Personal portfolio row — keep legacy id + plans (rename מנהל/מנהלת → סהר).
    personal = db.query(Investor).filter(Investor.name == PERSONAL_INVESTOR_NAME).first()
    if personal is None:
        legacy = (
            db.query(Investor)
            .filter(Investor.name.in_(("מנהל", "מנהלת", PERSONAL_INVESTOR_NAME)))
            .order_by(Investor.id.asc())
            .first()
        )
        if legacy is not None:
            if legacy.name != PERSONAL_INVESTOR_NAME:
                old_name = legacy.name
                legacy.name = PERSONAL_INVESTOR_NAME
                updated.append(f"renamed:{old_name}->{PERSONAL_INVESTOR_NAME}")
        else:
            db.add(Investor(name=PERSONAL_INVESTOR_NAME, is_manager=False))
            created.append(PERSONAL_INVESTOR_NAME)
    personal = db.query(Investor).filter(Investor.name == PERSONAL_INVESTOR_NAME).first()
    if personal is not None:
        personal.is_manager = False

    db.flush()
    personal_id = personal.id if personal else None

    # 2) Empty admin shell — always a separate row; never repurpose the personal portfolio id.
    admin = db.query(Investor).filter(Investor.name == ADMIN_INVESTOR_NAME).first()
    if admin is None:
        db.add(
            Investor(
                name=ADMIN_INVESTOR_NAME,
                is_manager=True,
                notes="חשבון מנהל מערכת — ללא תיק השקעה אישי",
            )
        )
        created.append(ADMIN_INVESTOR_NAME)
    else:
        admin.is_manager = True
        if personal_id is not None and admin.id == personal_id:
            db.add(
                Investor(
                    name=ADMIN_INVESTOR_NAME,
                    is_manager=True,
                    notes="חשבון מנהל מערכת — ללא תיק השקעה אישי",
                )
            )
            created.append(f"{ADMIN_INVESTOR_NAME}:shell")

    db.flush()

    # 3) Demo investors — first bootstrap only (never resurrect after delete).
    demo_seeded = bool(getattr(settings, "demo_investors_seeded", False))
    if not demo_seeded:
        names = investor_names()
        non_system = names - SYSTEM_INVESTOR_NAMES
        # Fresh install: only system rows (or empty) → create demo roster once.
        if not non_system:
            for name in DEMO_INVESTOR_NAMES:
                if name not in names:
                    db.add(Investor(name=name, is_manager=False))
                    created.append(name)
        settings.demo_investors_seeded = True
        updated.append("demo_investors_seeded")

    db.commit()

    from app.services import auth_service as auth_svc

    deduped = auth_svc.dedupe_investors_and_users(db)
    users = auth_svc.seed_users(db)
    return {
        "created": created,
        "updated": updated,
        "deduped": deduped,
        "users": users,
    }


def plan_track_end_date(plan: InvestmentPlan) -> date:
    """Last calendar month of the track (start + effective duration − 1)."""
    duration = plan_effective_duration(plan) or max(plan.duration_months, 1)
    return add_months(plan.start_date, max(duration, 1) - 1)


def plan_accrual_principal(plan: InvestmentPlan) -> float:
    """Principal used for savings accrual — stable when savings moves into קרן."""
    raw = getattr(plan, "accrual_principal", None)
    if raw is None:
        return float(plan.principal or 0)
    return float(raw)


def accrued_savings_for_plan(
    plan: InvestmentPlan, today: Optional[date] = None
) -> float:
    """Gross savings accrued from terms (before withdrawals/transfers)."""
    today = today or date.today()
    _, _, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    duration = plan_effective_duration(plan)
    if savings_rate <= 0 or duration <= 0:
        return 0.0
    elapsed = months_elapsed_inclusive(plan.start_date, today, cap=duration)
    if elapsed <= 0:
        return 0.0
    rows = month_savings_ledger(
        principal=plan_accrual_principal(plan),
        savings_rate_percent=savings_rate,
        duration_months=duration,
    )
    row = next((r for r in rows if r["month_number"] == elapsed), None)
    return float(row["cumulative_savings"]) if row else 0.0


def available_savings_for_plan(
    plan: InvestmentPlan, today: Optional[date] = None
) -> float:
    """Savings still available to withdraw or move into principal."""
    accrued = accrued_savings_for_plan(plan, today)
    redeemed = float(getattr(plan, "savings_redeemed_total", 0.0) or 0.0)
    rollover = float(getattr(plan, "rollover_savings_balance", 0.0) or 0.0)
    return max(0.0, round(accrued - redeemed + rollover, 2))


def current_savings_for_plan(
    plan: InvestmentPlan, today: Optional[date] = None
) -> float:
    """Public 'current savings' = available balance (after redemptions)."""
    return available_savings_for_plan(plan, today)


def plan_metrics(plan: InvestmentPlan, today: Optional[date] = None) -> dict:
    today = today or date.today()
    duration = plan_effective_duration(plan)
    accrual_principal = plan_accrual_principal(plan)
    track = track_metrics(
        principal=plan.principal,
        plan_type=getattr(plan, "plan_type", None) or "monthly",
        monthly_rate_percent=plan.monthly_rate_percent,
        savings_rate_percent=getattr(plan, "savings_rate_percent", 0.0) or 0.0,
        manager_fee_percent=plan.manager_fee_percent,
        duration_months=duration if duration > 0 else plan.duration_months,
    )
    # Savings accrual line uses accrual principal (not boosted קרן).
    savings_track = track_metrics(
        principal=accrual_principal,
        plan_type=getattr(plan, "plan_type", None) or "monthly",
        monthly_rate_percent=plan.monthly_rate_percent,
        savings_rate_percent=getattr(plan, "savings_rate_percent", 0.0) or 0.0,
        manager_fee_percent=plan.manager_fee_percent,
        duration_months=duration if duration > 0 else plan.duration_months,
    )
    elapsed = months_elapsed_inclusive(
        plan.start_date, today, cap=duration if duration > 0 else plan.duration_months
    )
    remaining = max((duration if duration > 0 else plan.duration_months) - elapsed, 0)
    payments = plan.payments or []
    paid = [p for p in payments if p.status == "paid"]
    accrued = accrued_savings_for_plan(plan, today)
    available = available_savings_for_plan(plan, today)
    redeemed = float(getattr(plan, "savings_redeemed_total", 0.0) or 0.0)
    return {
        "monthly_investor_payout": track["monthly_investor_payout"],
        "monthly_manager_fee": track["monthly_manager_fee"],
        "monthly_savings_accrual": savings_track["monthly_savings_accrual"],
        "projected_savings_balance": round(
            available
            + max(
                0.0,
                savings_track["projected_savings_balance"] - accrued,
            ),
            2,
        ),
        "accrued_savings_balance": round(accrued, 2),
        "current_savings_balance": available,
        "savings_redeemed_total": round(redeemed, 2),
        "rollover_savings_balance": round(
            float(getattr(plan, "rollover_savings_balance", 0.0) or 0.0), 2
        ),
        "accrual_principal": round(accrual_principal, 2),
        "successor_plan_id": getattr(plan, "successor_plan_id", None),
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
        "effective_duration_months": duration if duration > 0 else plan.duration_months,
    }


def redeem_savings(
    db: Session,
    *,
    plan: InvestmentPlan,
    action_type: str,
    amount: float,
    actor_user_id: Optional[int] = None,
    notes: Optional[str] = None,
    commit: bool = True,
) -> dict:
    """Withdraw savings or transfer into principal. Never touches accrual history."""
    action_type = (action_type or "").strip().lower()
    if action_type not in {"withdraw", "transfer_to_principal"}:
        raise ValueError("סוג פעולה לא תקין")
    amount = round(float(amount or 0), 2)
    if amount <= 0:
        raise ValueError("סכום חייב להיות גדול מאפס")

    kind, _, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    if kind == "monthly" or savings_rate <= 0:
        raise ValueError("למסלול הזה אין חיסכון")

    # Ensure accrual principal is frozen before first redemption / principal boost.
    if getattr(plan, "accrual_principal", None) is None:
        plan.accrual_principal = float(plan.principal or 0)

    available = available_savings_for_plan(plan)
    if amount > available + 0.001:
        raise ValueError(
            f"אין מספיק חיסכון זמין (יתרה ₪{available:,.2f})"
        )

    plan.savings_redeemed_total = round(
        float(getattr(plan, "savings_redeemed_total", 0.0) or 0.0) + amount, 2
    )

    if action_type == "transfer_to_principal":
        plan.principal = round(float(plan.principal or 0) + amount, 2)
        # Future cash payments follow the new קרן.
        generate_payment_schedule(db, plan, realign_dates=False, commit=False)

    action = SavingsAction(
        plan_id=plan.id,
        investor_id=plan.investor_id,
        action_type=action_type,
        amount=amount,
        principal_after=plan.principal,
        available_after=available_savings_for_plan(plan),
        notes=notes,
        actor_user_id=actor_user_id,
    )
    db.add(action)
    if commit:
        db.commit()
        db.refresh(plan)
        db.refresh(action)
        plan = (
            db.query(InvestmentPlan)
            .options(
                joinedload(InvestmentPlan.investor),
                joinedload(InvestmentPlan.payments),
                joinedload(InvestmentPlan.savings_actions),
            )
            .filter(InvestmentPlan.id == plan.id)
            .one()
        )
    else:
        db.flush()
        action.available_after = available_savings_for_plan(plan)
    return {
        "action": {
            "id": action.id,
            "action_type": action.action_type,
            "amount": action.amount,
            "principal_after": action.principal_after,
            "available_after": action.available_after,
            "created_at": action.created_at,
            "notes": action.notes,
        },
        "plan": serialize_plan(plan) if commit else None,
    }


def _close_plan_remaining_payments(db: Session, plan: InvestmentPlan) -> int:
    """Mark unpaid future rows as skipped when a track is closed."""
    skipped = 0
    for payment in db.query(Payment).filter(Payment.plan_id == plan.id).all():
        if payment.status in {"scheduled", "awaiting_confirmation"}:
            payment.status = "skipped"
            payment.notes = (payment.notes or "") or "נסגר עם המסלול"
            skipped += 1
    return skipped


def settle_savings_action(
    db: Session,
    *,
    plan: InvestmentPlan,
    action_type: str,
    amount: float,
    outcome: str,
    actor_user_id: Optional[int] = None,
    notes: Optional[str] = None,
    withdraw_remaining: bool = True,
    compound_savings: bool = True,
    include_monthly_cash: bool = True,
    monthly_rate_percent: float = 0.0,
    savings_rate_percent: float = 0.0,
    manager_fee_percent: Optional[float] = None,
    new_principal: Optional[float] = None,
    new_duration_months: int = 12,
    new_start_date: Optional[date] = None,
) -> dict:
    """Redeem savings then either close the track or open a successor plan.

    Questionnaire outcomes:
    - close_plan: optional full remaining withdraw + status=completed
    - continue_new_track: close source, open new 12m track with chosen rates
    """
    outcome = (outcome or "").strip().lower()
    if outcome not in {"close_plan", "continue_new_track"}:
        raise ValueError("יש לבחור: המשך מסלול חדש או סגירה מלאה")

    primary = redeem_savings(
        db,
        plan=plan,
        action_type=action_type,
        amount=amount,
        actor_user_id=actor_user_id,
        notes=notes,
        commit=False,
    )

    residual_action = None
    leftover = available_savings_for_plan(plan)
    if leftover > 0.001:
        if outcome == "close_plan" and withdraw_remaining:
            residual_action = redeem_savings(
                db,
                plan=plan,
                action_type="withdraw",
                amount=leftover,
                actor_user_id=actor_user_id,
                notes="משיכת יתרת חיסכון בסגירת מסלול",
                commit=False,
            )["action"]
        elif outcome == "continue_new_track":
            # Roll leftover savings into קרן before opening the successor track.
            residual_action = redeem_savings(
                db,
                plan=plan,
                action_type="transfer_to_principal",
                amount=leftover,
                actor_user_id=actor_user_id,
                notes="יתרת חיסכון הועברה לקרן לפני מסלול חדש",
                commit=False,
            )["action"]

    new_plan: Optional[InvestmentPlan] = None
    if outcome == "continue_new_track":
        # Derive track type from questionnaire answers.
        if not compound_savings and not include_monthly_cash:
            raise ValueError("בחר לפחות החזר חודשי או צבירת חיסכון למסלול החדש")
        if compound_savings and include_monthly_cash:
            plan_type = "hybrid"
        elif compound_savings:
            plan_type = "savings"
        else:
            plan_type = "monthly"

        kind, monthly_rate, savings_rate = normalize_plan_rates(
            plan_type,
            float(monthly_rate_percent or 0),
            float(savings_rate_percent or 0),
        )
        if compound_savings and savings_rate <= 0:
            raise ValueError("לריבית דריבית צריך אחוז חיסכון גדול מאפס")
        if include_monthly_cash and monthly_rate <= 0 and kind != "savings":
            raise ValueError("להחזר חודשי במזומן צריך אחוז גדול מאפס")

        principal_for_new = round(
            float(
                new_principal
                if new_principal is not None
                else (plan.principal or 0)
            ),
            2,
        )
        if principal_for_new <= 0:
            raise ValueError("קרן למסלול החדש חייבת להיות גדולה מאפס")

        duration = int(new_duration_months or 12)
        if duration < 1 or duration > 120:
            raise ValueError("משך מסלול לא תקין")

        start = new_start_date or date.today().replace(day=1)
        fee = (
            float(manager_fee_percent)
            if manager_fee_percent is not None
            else float(plan.manager_fee_percent or 0)
        )

        note_bits = [f"המשך ממסלול #{plan.id}"]
        if compound_savings:
            note_bits.append(f"ריבית דריבית {duration} ח׳")
        new_plan = InvestmentPlan(
            investor_id=plan.investor_id,
            principal=principal_for_new,
            accrual_principal=principal_for_new,
            savings_redeemed_total=0.0,
            plan_type=kind,
            monthly_rate_percent=monthly_rate,
            savings_rate_percent=savings_rate,
            manager_fee_percent=fee,
            start_date=start,
            duration_months=duration,
            status="active",
            notes=" · ".join(note_bits),
        )
        db.add(new_plan)
        db.flush()
        generate_payment_schedule(db, new_plan, realign_dates=True, commit=False)
        plan.successor_plan_id = new_plan.id
        plan.notes = (
            (plan.notes + " · " if plan.notes else "")
            + f"נסגר — המשך במסלול #{new_plan.id}"
        )

    # Close source track (both outcomes end the current savings track).
    plan.status = "completed"
    _close_plan_remaining_payments(db, plan)
    if outcome == "close_plan":
        plan.notes = (
            (plan.notes + " · " if plan.notes else "") + "נסגר לגמרי אחרי משיכה/העברה"
        )

    db.commit()

    plan = (
        db.query(InvestmentPlan)
        .options(
            joinedload(InvestmentPlan.investor),
            joinedload(InvestmentPlan.payments),
            joinedload(InvestmentPlan.savings_actions),
        )
        .filter(InvestmentPlan.id == plan.id)
        .one()
    )
    new_serialized = None
    if new_plan is not None:
        new_plan = (
            db.query(InvestmentPlan)
            .options(
                joinedload(InvestmentPlan.investor),
                joinedload(InvestmentPlan.payments),
            )
            .filter(InvestmentPlan.id == new_plan.id)
            .one()
        )
        new_serialized = serialize_plan(new_plan)

    return {
        "outcome": outcome,
        "action": primary["action"],
        "residual_action": residual_action,
        "closed_plan": serialize_plan(plan),
        "new_plan": new_serialized,
    }


AUTO_EXTEND_MONTHS = 12


def _plan_blocks_auto_continue(plan: InvestmentPlan) -> bool:
    notes = plan.notes or ""
    if "נסגר לגמרי" in notes:
        return True
    if reporting_year_from_notes(notes):
        return True
    return False


def _plan_savings_already_rolled(plan: InvestmentPlan) -> bool:
    notes = plan.notes or ""
    return "חיסכון הועבר" in notes


def _primary_active_savings_plan(
    plans: list[InvestmentPlan],
) -> Optional[InvestmentPlan]:
    candidates: list[InvestmentPlan] = []
    for plan in plans:
        if plan.status != "active":
            continue
        kind, _, savings_rate = normalize_plan_rates(
            getattr(plan, "plan_type", None) or "monthly",
            plan.monthly_rate_percent,
            getattr(plan, "savings_rate_percent", 0.0) or 0.0,
        )
        if kind != "monthly" and savings_rate > 0:
            candidates.append(plan)
    if not candidates:
        return None
    return max(candidates, key=lambda p: (p.start_date or date.min, p.id))


def _inject_rollover_into_plan(
    db: Session,
    *,
    to_plan: InvestmentPlan,
    amount: float,
    from_plan_id: int,
) -> None:
    """Credit rolled savings onto the active track's available balance."""
    to_plan.rollover_savings_balance = round(
        float(getattr(to_plan, "rollover_savings_balance", 0.0) or 0.0) + amount,
        2,
    )
    db.add(
        SavingsAction(
            plan_id=to_plan.id,
            investor_id=to_plan.investor_id,
            action_type="transfer_to_principal",
            amount=amount,
            principal_after=to_plan.principal,
            available_after=available_savings_for_plan(to_plan),
            notes=f"העברת חיסכון אוטומטית ממסלול #{from_plan_id}",
        )
    )


def roll_savings_to_active_plan(
    db: Session,
    *,
    from_plan: InvestmentPlan,
    to_plan: InvestmentPlan,
    today: Optional[date] = None,
) -> float:
    """Transfer leftover savings from a closed track into the investor's active track."""
    if from_plan.id == to_plan.id:
        return 0.0
    if from_plan.status != "completed":
        return 0.0
    if _plan_blocks_auto_continue(from_plan) or _plan_savings_already_rolled(from_plan):
        return 0.0

    amount = available_savings_for_plan(from_plan, today)
    if amount <= 0.001:
        return 0.0

    from_plan.savings_redeemed_total = round(
        float(getattr(from_plan, "savings_redeemed_total", 0.0) or 0.0) + amount,
        2,
    )
    db.add(
        SavingsAction(
            plan_id=from_plan.id,
            investor_id=from_plan.investor_id,
            action_type="withdraw",
            amount=amount,
            principal_after=from_plan.principal,
            available_after=available_savings_for_plan(from_plan, today),
            notes=f"הועבר למסלול פעיל #{to_plan.id}",
        )
    )
    _inject_rollover_into_plan(
        db, to_plan=to_plan, amount=amount, from_plan_id=from_plan.id
    )
    if not from_plan.successor_plan_id:
        from_plan.successor_plan_id = to_plan.id
    from_plan.notes = (
        (from_plan.notes + " · " if from_plan.notes else "")
        + f"חיסכון הועבר למסלול #{to_plan.id}"
    )
    return amount


def auto_extend_active_plan(
    db: Session,
    plan: InvestmentPlan,
    today: Optional[date] = None,
) -> bool:
    """Extend an active track by 12 months once its term ends (unless explicitly closed)."""
    today = today or date.today()
    if plan.status != "active" or _plan_blocks_auto_continue(plan):
        return False

    metrics = plan_metrics(plan, today)
    if metrics["months_remaining"] > 0:
        return False

    plan.duration_months = int(plan.duration_months or 0) + AUTO_EXTEND_MONTHS
    marker = f"המשך אוטומטי +{AUTO_EXTEND_MONTHS} ח׳"
    if marker not in (plan.notes or ""):
        plan.notes = (plan.notes + " · " if plan.notes else "") + marker
    generate_payment_schedule(db, plan, realign_dates=False, commit=False)
    return True


def sync_investor_track_continuity(
    db: Session,
    investor: Investor,
    today: Optional[date] = None,
) -> dict:
    """Roll closed-track savings into the active track and auto-extend active timelines."""
    today = today or date.today()
    plans = list(investor.plans or [])
    target = _primary_active_savings_plan(plans)
    extended = 0
    rolled = 0.0

    for plan in plans:
        if auto_extend_active_plan(db, plan, today):
            extended += 1

    if target is not None:
        for plan in sorted(plans, key=lambda p: p.id):
            moved = roll_savings_to_active_plan(
                db, from_plan=plan, to_plan=target, today=today
            )
            rolled += moved

    return {"extended": extended, "rolled_amount": round(rolled, 2)}


def sync_track_continuity(
    db: Session,
    *,
    investor_id: Optional[int] = None,
    today: Optional[date] = None,
) -> dict:
    """Apply savings rollover + auto-extension for one or all investors."""
    today = today or date.today()
    query = db.query(Investor).options(
        joinedload(Investor.plans).joinedload(InvestmentPlan.payments)
    )
    if investor_id is not None:
        query = query.filter(Investor.id == investor_id)
    totals = {"investors": 0, "extended": 0, "rolled_amount": 0.0}
    for investor in query.all():
        result = sync_investor_track_continuity(db, investor, today)
        totals["investors"] += 1
        totals["extended"] += result["extended"]
        totals["rolled_amount"] = round(totals["rolled_amount"] + result["rolled_amount"], 2)
    return totals


def serialize_plan(plan: InvestmentPlan, *, hide_fees: bool = False) -> dict:
    metrics = plan_metrics(plan)
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    duration = metrics.get("effective_duration_months") or plan.duration_months
    payload = {
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
        "duration_months": duration,
        "status": plan.status,
        "notes": plan.notes,
        "created_at": plan.created_at,
        **{k: v for k, v in metrics.items() if k != "effective_duration_months"},
    }
    payload.update(_cooling_off_fields(plan))
    if hide_fees:
        return redact_manager_fees(payload)
    return payload


EXECUTED_TOPUP_STATUSES = {"approved", "executed"}
OPEN_TOPUP_STATUSES = {"pending", "contract"}
MAX_SIGNATURE_PNG_CHARS = 900_000


def track_calendar_end_date(start: date, duration_months: int) -> date:
    """Last calendar day of the track (start + duration months − 1 day)."""
    return add_months(start, max(int(duration_months or 1), 1)) - timedelta(days=1)


def _is_executed_topup(status: Optional[str]) -> bool:
    return (status or "") in EXECUTED_TOPUP_STATUSES


def _cooling_off_fields(plan: InvestmentPlan, *, now: Optional[datetime] = None) -> dict:
    request = getattr(plan, "source_request", None)
    if request is None or not _is_executed_topup(request.status) or not request.cancel_until:
        return {
            "source_request_id": request.id if request is not None else None,
            "cooling_off_until": None,
            "cooling_off_days_left": 0,
            "can_cancel_investment": False,
        }
    now_utc = _as_utc(now or datetime.now(timezone.utc))
    until_utc = _as_utc(request.cancel_until)
    active = plan.status == "active" and now_utc <= until_utc
    return {
        "source_request_id": request.id,
        "cooling_off_until": request.cancel_until,
        "cooling_off_days_left": israel_business_days_remaining(request.cancel_until, now=now_utc)
        if active
        else 0,
        "can_cancel_investment": active,
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


def serialize_investor(
    investor: Investor,
    today: Optional[date] = None,
    db: Optional[Session] = None,
) -> dict:
    """Investor summary with cash and savings kept as separate money lines.

    monthly_payout / monthly_cash = cash return only (what is paid out monthly).
    monthly_savings = accrual only from *active* plans (not cash in hand).
    current_savings_balance = lifetime accrued across all tracks, without overlap.
    """
    today = today or date.today()
    all_plans = list(investor.plans or [])
    active_plans = [p for p in all_plans if p.status == "active"]
    active_principal = 0.0
    monthly_cash = 0.0
    monthly_savings = 0.0
    current_savings = 0.0
    projected_savings = 0.0
    cash_rate_weight = 0.0
    savings_rate_weight = 0.0
    plan_types: list[str] = []

    for p in active_plans:
        metrics = plan_metrics(p, today)
        kind, cash_rate, savings_rate = normalize_plan_rates(
            getattr(p, "plan_type", None) or "monthly",
            p.monthly_rate_percent,
            getattr(p, "savings_rate_percent", 0.0) or 0.0,
        )
        principal = float(p.principal or 0)
        active_principal += principal
        monthly_cash += metrics["monthly_investor_payout"]
        monthly_savings += metrics["monthly_savings_accrual"]
        cash_rate_weight += cash_rate * principal
        savings_rate_weight += savings_rate * principal
        plan_types.append(kind)
        projected_savings += metrics["projected_savings_balance"]

    # Lifetime savings: every track with savings, each capped so periods don't overlap.
    for p in all_plans:
        kind, _, savings_rate = normalize_plan_rates(
            getattr(p, "plan_type", None) or "monthly",
            p.monthly_rate_percent,
            getattr(p, "savings_rate_percent", 0.0) or 0.0,
        )
        if kind == "monthly" or savings_rate <= 0:
            continue
        metrics = plan_metrics(p, today)
        current_savings += metrics["current_savings_balance"]
        if p.status != "active":
            # Completed tracks still contribute their frozen projected end balance
            # only via current; don't add their projected into active projection.
            pass

    active_principal = round(active_principal, 2)
    monthly_cash = round(monthly_cash, 2)
    monthly_savings = round(monthly_savings, 2)
    if active_principal > 0:
        blended_cash_rate = round(cash_rate_weight / active_principal, 4)
        blended_savings_rate = round(savings_rate_weight / active_principal, 4)
    else:
        blended_cash_rate = 0.0
        blended_savings_rate = 0.0

    if active_plans:
        earliest = min(p.start_date for p in active_plans)
        months_in = months_elapsed_inclusive(
            earliest, today, cap=max(p.duration_months for p in active_plans) * 2
        )
    elif all_plans:
        earliest = min(p.start_date for p in all_plans if p.start_date)
        months_in = months_between(earliest, today) if earliest else 0
    else:
        months_in = 0
    access_username = None
    access_password = None
    access_email = None
    access_role = None
    has_login = False
    user = getattr(investor, "user", None)
    if user is not None:
        access_username = user.username
        access_password = user.access_password
        access_email = user.email
        access_role = user.role
        has_login = bool(user.password_hash) and not user.must_reset_password

    if not access_password and db is not None:
        quote = (
            db.query(Quote)
            .filter(
                Quote.converted_investor_id == investor.id,
                Quote.access_password.isnot(None),
                Quote.access_password != "",
            )
            .order_by(Quote.id.desc())
            .first()
        )
        if quote:
            access_password = quote.access_password
            if user is not None and not user.access_password:
                user.access_password = quote.access_password
                db.flush()

    unique_types = sorted(set(plan_types))
    return {
        "id": investor.id,
        "name": investor.name,
        "is_manager": investor.is_manager,
        "phone": investor.phone,
        "notes": investor.notes,
        "created_at": investor.created_at,
        "active_principal": active_principal,
        "monthly_payout": monthly_cash,
        "monthly_cash": monthly_cash,
        "monthly_savings": monthly_savings,
        "monthly_total": round(monthly_cash + monthly_savings, 2),
        "cash_rate_percent": blended_cash_rate,
        "savings_rate_percent": blended_savings_rate,
        "current_savings_balance": round(current_savings, 2),
        "projected_savings_balance": round(projected_savings, 2),
        "active_plans_count": len(active_plans),
        "plan_types": unique_types,
        "months_in_program": months_in,
        "plans_count": len(all_plans),
        "access_username": access_username,
        "access_password": access_password,
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
        "phone": quote.phone,
        "access_username": quote.access_username,
        "access_password": quote.access_password,
        "start_date": quote.start_date,
        "principal": quote.principal,
        "plan_type": kind,
        "monthly_rate_percent": monthly_rate,
        "savings_rate_percent": savings_rate,
        "manager_fee_percent": quote.manager_fee_percent,
        "duration_months": quote.duration_months,
        "notes": quote.notes,
        "status": normalize_quote_status(quote.status),
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
    duration = plan_effective_duration(plan) or plan.duration_months
    cash_monthly = calc_monthly(plan.principal, monthly_rate)
    manager_monthly = calc_monthly(plan.principal, plan.manager_fee_percent)
    savings_rows = {
        r["month_number"]: r
        for r in month_savings_ledger(
            principal=plan.principal,
            savings_rate_percent=savings_rate,
            duration_months=duration,
        )
    }
    payments_by_month = {
        p.month_number: p for p in (plan.payments or []) if p.month_number
    }
    months: list[dict] = []
    cumulative_cash = 0.0
    for month in range(1, duration + 1):
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
        "duration_months": duration,
        "monthly_cash": cash_monthly,
        "monthly_savings_accrual": calc_monthly(plan.principal, savings_rate)
        if savings_rate
        else 0.0,
        "projected_savings_balance": (
            savings_rows.get(duration, {}).get("cumulative_savings", 0.0)
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
    commit: bool = True,
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
        if commit:
            db.commit()
        else:
            db.flush()
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

    if commit:
        db.commit()
    else:
        db.flush()
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
    """Startup safety: remove payment duplicates and clip reporting boards to Dec.

    Mid-year 'לוח דיווח' boards must not run into the next calendar year — that
    overlaps the next active plan and double-counts monthly savings.
    """
    dupes = dedupe_all_payments(db)
    clipped = clip_reporting_year_plan_spans(db)
    return {
        "duplicate_payments_removed": dupes["removed"],
        "plans_realigned": 0,
        "active_starts_fixed": 0,
        "reporting_plans_clipped": clipped["clipped"],
        "reporting_plans_restored": 0,
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
    """All savings/hybrid tracks for lifetime totals (each capped — no overlap)."""
    query = db.query(InvestmentPlan).options(
        joinedload(InvestmentPlan.investor),
        joinedload(InvestmentPlan.payments),
    )
    if investor_id is not None:
        query = query.filter(InvestmentPlan.investor_id == investor_id)
    plans = query.order_by(InvestmentPlan.start_date, InvestmentPlan.id).all()
    chosen: list[InvestmentPlan] = []
    for plan in plans:
        kind, _, savings_rate = normalize_plan_rates(
            getattr(plan, "plan_type", None) or "monthly",
            plan.monthly_rate_percent,
            getattr(plan, "savings_rate_percent", 0.0) or 0.0,
        )
        if kind == "monthly" or savings_rate <= 0:
            continue
        chosen.append(plan)
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
    """Clip a reporting board so it ends in December of `year`."""
    if not plan.start_date or plan.start_date.year != year:
        return False
    target = months_through_december(plan.start_date)
    changed = False
    if plan.duration_months != target:
        plan.duration_months = target
        changed = True
    year_end = date(year, 12, 31)
    removed = 0
    for payment in list(plan.payments or []):
        overdue = payment.due_date and payment.due_date > year_end
        over_month = (payment.month_number or 0) > target
        if overdue or over_month:
            if payment.status in {"paid", "awaiting_confirmation"}:
                continue
            db.delete(payment)
            removed += 1
            changed = True
    if changed:
        db.commit()
        if removed or not (plan.payments or []):
            generate_payment_schedule(db, plan, realign_dates=False)
    return changed


def clip_reporting_year_plan_spans(db: Session) -> dict:
    """Clip 'לוח דיווח לשנת YYYY' plans to December of that year.

    Prevents a Sep-2025 board with duration=12 from accruing savings through
    Aug-2026 on top of the investor's 2026 active plan (double ~₪1,100/mo).
    """
    clipped = 0
    plans = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.payments))
        .all()
    )
    for plan in plans:
        year = reporting_year_from_notes(plan.notes)
        if not year or not plan.start_date or plan.start_date.year != year:
            continue
        target = months_through_december(plan.start_date)
        if plan.duration_months == target:
            # Still drop any stray payments past December.
            year_end = date(year, 12, 31)
            stray = [
                p
                for p in (plan.payments or [])
                if (p.due_date and p.due_date > year_end)
                or (p.month_number or 0) > target
            ]
            if not stray:
                continue
        if clip_plan_to_calendar_year(db, plan, year):
            clipped += 1
    return {"clipped": clipped}


def restore_midyear_reporting_plan_durations(db: Session) -> dict:
    """Deprecated: expanding mid-year boards caused savings double-counts.

    Kept as a no-op alias so old callers stay safe; use clip instead.
    """
    return clip_reporting_year_plan_spans(db)


def repair_midyear_reporting_plans(db: Session) -> dict:
    """Clip overlapping reporting-year boards (do not expand them)."""
    result = clip_reporting_year_plan_spans(db)
    return {"clipped": result["clipped"], "restored": 0}


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
        # Reporting boards stop in December of that year — never spill into the next
        # plan's months (that was the Bar ~₪1,100 savings double-count).
        duration = months_through_december(start)

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


def delete_investor_and_history(db: Session, *, investor_id: int) -> dict:
    """Remove an investor, login user, and all related financial history."""
    from app.models.auth import ActivityEvent, LoginAlert, PasswordResetRequest, PasswordResetToken, User

    investor = db.query(Investor).filter(Investor.id == investor_id).first()
    if not investor:
        raise ValueError("משקיע לא נמצא")

    user = db.query(User).filter(User.investor_id == investor_id).first()
    plan_ids = [
        row[0]
        for row in db.query(InvestmentPlan.id)
        .filter(InvestmentPlan.investor_id == investor_id)
        .all()
    ]

    if plan_ids:
        db.query(InvestmentPlan).filter(
            InvestmentPlan.successor_plan_id.in_(plan_ids)
        ).update({"successor_plan_id": None}, synchronize_session=False)
    db.query(InvestmentPlan).filter(InvestmentPlan.investor_id == investor_id).update(
        {"successor_plan_id": None}, synchronize_session=False
    )
    db.query(InvestmentTopupRequest).filter(
        InvestmentTopupRequest.investor_id == investor_id
    ).update({"created_plan_id": None}, synchronize_session=False)

    # Keep activity trail; detach FKs so history survives user/investor deletion.
    db.query(ActivityEvent).filter(ActivityEvent.investor_id == investor_id).update(
        {"investor_id": None}, synchronize_session=False
    )
    if user:
        db.query(ActivityEvent).filter(ActivityEvent.actor_user_id == user.id).update(
            {"actor_user_id": None}, synchronize_session=False
        )

    deleted = {
        "investor_id": investor_id,
        "investor_name": investor.name,
        "savings_actions": db.query(SavingsAction)
        .filter(SavingsAction.investor_id == investor_id)
        .delete(synchronize_session=False),
        "payments": db.query(Payment)
        .filter(Payment.investor_id == investor_id)
        .delete(synchronize_session=False),
        "topup_requests": db.query(InvestmentTopupRequest)
        .filter(InvestmentTopupRequest.investor_id == investor_id)
        .delete(synchronize_session=False),
        "plans": db.query(InvestmentPlan)
        .filter(InvestmentPlan.investor_id == investor_id)
        .delete(synchronize_session=False),
        "quotes": db.query(Quote)
        .filter(Quote.converted_investor_id == investor_id)
        .delete(synchronize_session=False),
    }

    if user:
        deleted["login_alerts"] = (
            db.query(LoginAlert)
            .filter(
                (LoginAlert.user_id == user.id) | (LoginAlert.investor_id == investor_id)
            )
            .delete(synchronize_session=False)
        )
        deleted["password_reset_requests"] = (
            db.query(PasswordResetRequest)
            .filter(PasswordResetRequest.user_id == user.id)
            .delete(synchronize_session=False)
        )
        deleted["password_reset_tokens"] = (
            db.query(PasswordResetToken)
            .filter(PasswordResetToken.user_id == user.id)
            .delete(synchronize_session=False)
        )
        db.delete(user)
        deleted["user"] = 1
    else:
        deleted["login_alerts"] = (
            db.query(LoginAlert)
            .filter(LoginAlert.investor_id == investor_id)
            .delete(synchronize_session=False)
        )
        deleted["user"] = 0

    db.delete(investor)
    db.commit()
    return deleted


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
    """Portfolio summary. Cash and savings are never mixed into one payout number.

    monthly_investor_payouts = cash only (paid monthly to investors).
    monthly_savings_accruals = savings accrual only (separate ledger line).
    Paid YTD / lifetime come from payment rows (cash only) — no double count.
    """
    today = date.today()
    investors_query = (
        db.query(Investor)
        .options(
            joinedload(Investor.plans).joinedload(InvestmentPlan.payments),
            joinedload(Investor.user),
        )
        .order_by(Investor.id)
    )
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
    monthly_investor_cash = 0.0
    monthly_investor_savings = 0.0
    projected_savings_total = 0.0
    monthly_manager_fees = 0.0
    monthly_manager_own_cash = 0.0
    monthly_manager_own_savings = 0.0

    for plan in plans:
        metrics = plan_metrics(plan, today)
        total_principal += plan.principal
        monthly_investor_cash += metrics["monthly_investor_payout"]
        monthly_investor_savings += metrics["monthly_savings_accrual"]
        projected_savings_total += metrics["projected_savings_balance"]
        monthly_manager_fees += metrics["monthly_manager_fee"]
        if plan.investor and plan.investor.is_manager:
            monthly_manager_own_cash += metrics["monthly_investor_payout"]
            monthly_manager_own_savings += metrics["monthly_savings_accrual"]

    investors_summary = [serialize_investor(i, today) for i in investors]
    # Lifetime savings across all tracks (completed + active), already de-overlapped.
    current_savings_total = round(
        sum(float(s.get("current_savings_balance") or 0) for s in investors_summary),
        2,
    )

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

    monthly_manager_own = round(monthly_manager_own_cash + monthly_manager_own_savings, 2)
    return {
        "scope_investor_id": investor_id,
        "total_principal": round(total_principal, 2),
        "monthly_investor_payouts": round(monthly_investor_cash, 2),
        "monthly_cash_payouts": round(monthly_investor_cash, 2),
        "monthly_savings_accruals": round(monthly_investor_savings, 2),
        "monthly_investor_total": round(
            monthly_investor_cash + monthly_investor_savings, 2
        ),
        "current_savings_total": current_savings_total,
        "projected_savings_total": round(projected_savings_total, 2),
        "monthly_manager_fees": round(monthly_manager_fees, 2),
        "monthly_manager_own_payout": round(monthly_manager_own_cash, 2),
        "monthly_manager_own_savings": round(monthly_manager_own_savings, 2),
        "monthly_manager_own_total": monthly_manager_own,
        "monthly_manager_total": round(monthly_manager_own + monthly_manager_fees, 2),
        "ytd_investor_paid": round(ytd_investor, 2),
        "ytd_manager_earned": round(ytd_manager, 2),
        "lifetime_investor_paid": round(lifetime_investor, 2),
        "lifetime_manager_earned": round(lifetime_manager, 2),
        "active_investors": len([i for i in investors if not i.is_manager and i.plans]),
        "active_plans": len(plans),
        "upcoming_payments": [serialize_payment(p) for p in upcoming],
        "recent_payments": [serialize_payment(p) for p in recent],
        "investors_summary": investors_summary,
    }


def get_manager_income_board(db: Session) -> dict:
    """Manager-only board: fee from each investor + Sahar's own investment return.

    monthly_grand_total = sum of fees from investors + Sahar's monthly return
    (cash + savings accrual) according to her active plan terms.
    """
    settings = ensure_settings(db)
    manager_name = (settings.manager_display_name or "סהר").strip() or "סהר"

    investors = (
        db.query(Investor)
        .options(joinedload(Investor.plans).joinedload(InvestmentPlan.payments))
        .order_by(Investor.name)
        .all()
    )

    fee_rows: list[dict] = []
    monthly_fees_total = 0.0
    for inv in investors:
        if inv.is_manager:
            continue
        active = [p for p in (inv.plans or []) if p.status == "active"]
        if not active:
            continue
        principal = round(sum(p.principal for p in active), 2)
        monthly_fee = round(
            sum(calc_monthly(p.principal, p.manager_fee_percent) for p in active),
            2,
        )
        plans_out = []
        for p in active:
            fee = calc_monthly(p.principal, p.manager_fee_percent)
            plans_out.append(
                {
                    "plan_id": p.id,
                    "plan_type": getattr(p, "plan_type", None) or "monthly",
                    "principal": p.principal,
                    "manager_fee_percent": p.manager_fee_percent,
                    "monthly_fee": fee,
                }
            )
        fee_rows.append(
            {
                "investor_id": inv.id,
                "investor_name": inv.name,
                "principal": principal,
                "monthly_fee": monthly_fee,
                "plans": plans_out,
            }
        )
        monthly_fees_total = round(monthly_fees_total + monthly_fee, 2)

    fee_rows.sort(key=lambda r: (-r["monthly_fee"], r["investor_name"]))

    from app.services.auth_service import PERSONAL_INVESTOR_NAME

    manager_inv = next((i for i in investors if i.name == PERSONAL_INVESTOR_NAME), None)
    if manager_inv is None:
        manager_inv = next((i for i in investors if i.is_manager), None)
    own_plans_out: list[dict] = []
    own_principal = 0.0
    own_cash = 0.0
    own_savings = 0.0
    if manager_inv is not None:
        for p in (manager_inv.plans or []):
            if p.status != "active":
                continue
            metrics = plan_metrics(p)
            own_principal = round(own_principal + p.principal, 2)
            own_cash = round(own_cash + metrics["monthly_investor_payout"], 2)
            own_savings = round(own_savings + metrics["monthly_savings_accrual"], 2)
            own_plans_out.append(
                {
                    "plan_id": p.id,
                    "plan_type": getattr(p, "plan_type", None) or "monthly",
                    "principal": p.principal,
                    "monthly_cash": metrics["monthly_investor_payout"],
                    "monthly_savings": metrics["monthly_savings_accrual"],
                    "monthly_total": round(
                        metrics["monthly_investor_payout"]
                        + metrics["monthly_savings_accrual"],
                        2,
                    ),
                    "savings_rate_percent": getattr(p, "savings_rate_percent", 0.0)
                    or 0.0,
                    "monthly_rate_percent": p.monthly_rate_percent,
                    "start_date": p.start_date,
                    "track_end_date": plan_track_end_date(p),
                    "duration_months": p.duration_months,
                    "months_elapsed": metrics["months_elapsed"],
                }
            )

    own_monthly_total = round(own_cash + own_savings, 2)
    monthly_grand_total = round(monthly_fees_total + own_monthly_total, 2)

    return {
        "manager_name": manager_name,
        "manager_investor_id": manager_inv.id if manager_inv else None,
        "investors": fee_rows,
        "monthly_fees_total": monthly_fees_total,
        "manager_own": {
            "investor_id": manager_inv.id if manager_inv else None,
            "investor_name": manager_inv.name if manager_inv else manager_name,
            "principal": own_principal,
            "monthly_cash": own_cash,
            "monthly_savings": own_savings,
            "monthly_total": own_monthly_total,
            "plans": own_plans_out,
        },
        "monthly_grand_total": monthly_grand_total,
    }


def _contract_number_for(request: InvestmentTopupRequest) -> str:
    year = (request.created_at or utcnow()).year
    return f"TZ-{year}-{request.id:04d}"


def _validate_signature_png(data: str) -> str:
    value = (data or "").strip()
    if not value.startswith("data:image/png;base64,"):
        raise ValueError("יש לחתום בלוח החתימה")
    if len(value) > MAX_SIGNATURE_PNG_CHARS:
        raise ValueError("קובץ החתימה גדול מדי — חתמו מחדש בקווים פשוטים")
    return value


def _clear_contract_signatures(request: InvestmentTopupRequest) -> None:
    request.manager_signed_at = None
    request.manager_signed_name = None
    request.manager_signature_png = None
    request.investor_signed_at = None
    request.investor_signed_name = None
    request.investor_signature_png = None


def serialize_topup_request(
    request: InvestmentTopupRequest,
    *,
    hide_fees: bool = True,
    now: Optional[datetime] = None,
    include_signatures: bool = False,
) -> dict:
    now_utc = _as_utc(now or datetime.now(timezone.utc))
    plan = request.created_plan
    cancel_until = request.cancel_until
    within_cooling = (
        _is_executed_topup(request.status)
        and cancel_until is not None
        and now_utc <= _as_utc(cancel_until)
        and plan is not None
        and plan.status == "active"
    )
    days_left = (
        israel_business_days_remaining(cancel_until, now=now_utc)
        if within_cooling and cancel_until is not None
        else 0
    )
    manager_signed = bool(request.manager_signed_at and request.manager_signature_png)
    investor_signed = bool(request.investor_signed_at and request.investor_signature_png)
    both_signed = manager_signed and investor_signed
    plan_type = request.offered_plan_type or (getattr(plan, "plan_type", None) if plan else None)
    monthly_rate = request.offered_monthly_rate_percent
    if monthly_rate is None and plan is not None:
        monthly_rate = plan.monthly_rate_percent
    savings_rate = request.offered_savings_rate_percent
    if savings_rate is None and plan is not None:
        savings_rate = getattr(plan, "savings_rate_percent", 0.0) or 0.0
    duration = request.offered_duration_months or (plan.duration_months if plan is not None else None)
    start_date = request.offered_start_date or (plan.start_date if plan is not None else None)
    end_date = request.offered_end_date
    if end_date is None and start_date is not None and duration:
        end_date = track_calendar_end_date(start_date, duration)
    fee = request.offered_management_fee_percent
    if fee is None and plan is not None:
        fee = plan.manager_fee_percent
    metrics = None
    if start_date is not None and duration and plan_type:
        metrics = track_metrics(
            principal=float(request.amount or 0),
            plan_type=plan_type,
            monthly_rate_percent=float(monthly_rate or 0),
            savings_rate_percent=float(savings_rate or 0),
            manager_fee_percent=float(fee or 0),
            duration_months=int(duration),
        )
    payload = {
        "id": request.id,
        "investor_id": request.investor_id,
        "investor_name": request.investor.name if request.investor else "",
        "amount": request.amount,
        "notes": request.notes,
        "status": request.status,
        "created_at": request.created_at,
        "reviewed_at": request.reviewed_at,
        "review_notes": request.review_notes,
        "created_plan_id": request.created_plan_id,
        "approved_at": request.approved_at,
        "executed_at": request.executed_at or request.approved_at,
        "cancel_until": cancel_until,
        "reversed_at": request.reversed_at,
        "can_cancel_request": request.status in OPEN_TOPUP_STATUSES,
        "can_reverse_investment": within_cooling,
        "cooling_off_days_left": days_left,
        "cooling_off_business_days": TOPUP_COOLING_OFF_BUSINESS_DAYS,
        "plan": serialize_plan(plan, hide_fees=hide_fees) if plan is not None else None,
        "contract_number": request.contract_number or _contract_number_for(request),
        "manager_party_name": request.manager_party_name,
        "plan_type": plan_type,
        "monthly_rate_percent": monthly_rate,
        "savings_rate_percent": savings_rate,
        "start_date": start_date,
        "end_date": end_date,
        "duration_months": duration,
        "offered_notes": request.offered_notes,
        "monthly_investor_payout": (metrics or {}).get("monthly_investor_payout"),
        "monthly_savings_accrual": (metrics or {}).get("monthly_savings_accrual"),
        "total_investor_payout": (metrics or {}).get("total_investor_payout"),
        "manager_signed": manager_signed,
        "investor_signed": investor_signed,
        "both_signed": both_signed,
        "contract_fully_signed": both_signed,
        "manager_signed_at": request.manager_signed_at,
        "manager_signed_name": request.manager_signed_name,
        "investor_signed_at": request.investor_signed_at,
        "investor_signed_name": request.investor_signed_name,
    }
    if include_signatures:
        payload["manager_signature_png"] = request.manager_signature_png
        payload["investor_signature_png"] = request.investor_signature_png
    if not hide_fees:
        payload["manager_fee_percent"] = fee
    return payload


def _load_topup_request(db: Session, request_id: int) -> Optional[InvestmentTopupRequest]:
    return (
        db.query(InvestmentTopupRequest)
        .options(
            joinedload(InvestmentTopupRequest.investor),
            joinedload(InvestmentTopupRequest.created_plan).joinedload(InvestmentPlan.investor),
            joinedload(InvestmentTopupRequest.created_plan).joinedload(InvestmentPlan.payments),
            joinedload(InvestmentTopupRequest.created_plan).joinedload(InvestmentPlan.source_request),
        )
        .filter(InvestmentTopupRequest.id == request_id)
        .first()
    )


def list_topup_requests(
    db: Session,
    *,
    investor_id: Optional[int] = None,
    status: Optional[str] = None,
    hide_fees: bool = True,
) -> list[dict]:
    query = db.query(InvestmentTopupRequest).options(
        joinedload(InvestmentTopupRequest.investor),
        joinedload(InvestmentTopupRequest.created_plan).joinedload(InvestmentPlan.investor),
        joinedload(InvestmentTopupRequest.created_plan).joinedload(InvestmentPlan.payments),
        joinedload(InvestmentTopupRequest.created_plan).joinedload(InvestmentPlan.source_request),
    )
    if investor_id is not None:
        query = query.filter(InvestmentTopupRequest.investor_id == investor_id)
    if status:
        query = query.filter(InvestmentTopupRequest.status == status)
    rows = query.order_by(InvestmentTopupRequest.created_at.desc()).all()
    return [serialize_topup_request(row, hide_fees=hide_fees) for row in rows]


def create_topup_request(
    db: Session,
    *,
    investor: Investor,
    amount: float,
    notes: Optional[str] = None,
    actor_user_id: Optional[int] = None,
) -> InvestmentTopupRequest:
    if amount <= 0:
        raise ValueError("יש להזין סכום גדול מאפס")
    pending = (
        db.query(InvestmentTopupRequest)
        .filter(
            InvestmentTopupRequest.investor_id == investor.id,
            InvestmentTopupRequest.status.in_(tuple(OPEN_TOPUP_STATUSES)),
        )
        .first()
    )
    if pending:
        raise ValueError("יש כבר בקשת מסלול פתוחה — בטלו אותה או השלימו את החתימות")
    request = InvestmentTopupRequest(
        investor_id=investor.id,
        amount=round(float(amount), 2),
        notes=(notes or "").strip() or None,
        status="pending",
        created_by_user_id=actor_user_id,
    )
    db.add(request)
    db.commit()
    loaded = _load_topup_request(db, request.id)
    assert loaded is not None
    return loaded


def cancel_topup_request(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    actor_user_id: Optional[int] = None,
    notes: Optional[str] = None,
) -> InvestmentTopupRequest:
    if request.status not in OPEN_TOPUP_STATUSES:
        raise ValueError("אפשר לבטל רק בקשה שעדיין ממתינה או חוזה שטרם בוצע")
    request.status = "cancelled"
    request.reviewed_at = utcnow()
    request.reviewed_by_user_id = actor_user_id
    if notes:
        request.review_notes = notes.strip()
    db.commit()
    loaded = _load_topup_request(db, request.id)
    assert loaded is not None
    return loaded


def reject_topup_request(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    actor_user_id: Optional[int] = None,
    notes: Optional[str] = None,
) -> InvestmentTopupRequest:
    if request.status not in OPEN_TOPUP_STATUSES:
        raise ValueError("אפשר לדחות רק בקשה ממתינה או חוזה שטרם בוצע")
    request.status = "rejected"
    request.reviewed_at = utcnow()
    request.reviewed_by_user_id = actor_user_id
    request.review_notes = (notes or "").strip() or "נדחתה על ידי המנהל"
    db.commit()
    loaded = _load_topup_request(db, request.id)
    assert loaded is not None
    return loaded


def offer_topup_contract(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    plan_type: str,
    monthly_rate_percent: float,
    savings_rate_percent: float,
    manager_fee_percent: float,
    start_date: date,
    duration_months: int,
    actor_user_id: Optional[int] = None,
    principal: Optional[float] = None,
    notes: Optional[str] = None,
    generate_schedule: bool = True,
) -> InvestmentTopupRequest:
    """Manager sets contract terms. The track is created only after both signatures."""
    del generate_schedule  # used later at execution
    if request.status not in OPEN_TOPUP_STATUSES:
        raise ValueError("אפשר להכין חוזה רק לבקשה פתוחה")
    if request.manager_signed_at or request.investor_signed_at:
        raise ValueError("לא ניתן לשנות תנאים אחרי שהחתימות התחילו")
    amount = float(principal) if principal is not None else float(request.amount)
    if amount <= 0:
        raise ValueError("יש להזין קרן גדולה מאפס")
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        plan_type or "monthly",
        monthly_rate_percent or 0,
        savings_rate_percent or 0,
    )
    settings = ensure_settings(db)
    offered_at = utcnow()
    request.status = "contract"
    request.amount = round(amount, 2)
    request.offered_plan_type = kind
    request.offered_monthly_rate_percent = monthly_rate
    request.offered_savings_rate_percent = savings_rate
    request.offered_management_fee_percent = float(manager_fee_percent or 0)
    request.offered_start_date = start_date
    request.offered_duration_months = int(duration_months)
    request.offered_end_date = track_calendar_end_date(start_date, duration_months)
    request.offered_at = offered_at
    request.offered_by_user_id = actor_user_id
    request.offered_notes = (notes or "").strip() or None
    request.reviewed_at = offered_at
    request.reviewed_by_user_id = actor_user_id
    request.manager_party_name = (settings.manager_display_name or "סהר").strip() or "סהר"
    request.contract_number = _contract_number_for(request)
    _clear_contract_signatures(request)
    db.commit()
    loaded = _load_topup_request(db, request.id)
    assert loaded is not None
    return loaded


def approve_topup_request(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    plan_type: str,
    monthly_rate_percent: float,
    savings_rate_percent: float,
    manager_fee_percent: float,
    start_date: date,
    duration_months: int,
    actor_user_id: Optional[int] = None,
    principal: Optional[float] = None,
    notes: Optional[str] = None,
    generate_schedule: bool = True,
) -> InvestmentTopupRequest:
    """Backward-compatible alias: preparing the contract, not executing the track."""
    return offer_topup_contract(
        db,
        request=request,
        plan_type=plan_type,
        monthly_rate_percent=monthly_rate_percent,
        savings_rate_percent=savings_rate_percent,
        manager_fee_percent=manager_fee_percent,
        start_date=start_date,
        duration_months=duration_months,
        actor_user_id=actor_user_id,
        principal=principal,
        notes=notes,
        generate_schedule=generate_schedule,
    )


def _execute_signed_contract(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    generate_schedule: bool = True,
) -> None:
    if request.created_plan_id:
        return
    if not request.offered_start_date or not request.offered_duration_months:
        raise ValueError("חסרים תנאי חוזה לביצוע")
    amount = round(float(request.amount), 2)
    kind, monthly_rate, savings_rate = normalize_plan_rates(
        request.offered_plan_type or "monthly",
        request.offered_monthly_rate_percent or 0,
        request.offered_savings_rate_percent or 0,
    )
    visible_notes = request.offered_notes or request.notes
    plan = InvestmentPlan(
        investor_id=request.investor_id,
        principal=amount,
        accrual_principal=amount,
        savings_redeemed_total=0.0,
        plan_type=kind,
        monthly_rate_percent=monthly_rate,
        savings_rate_percent=savings_rate,
        manager_fee_percent=float(request.offered_management_fee_percent or 0),
        start_date=request.offered_start_date,
        duration_months=int(request.offered_duration_months),
        status="active",
        notes=visible_notes,
    )
    db.add(plan)
    db.flush()
    if generate_schedule:
        generate_payment_schedule(db, plan, commit=False)
    executed_at = utcnow()
    request.status = "executed"
    request.created_plan_id = plan.id
    request.approved_at = executed_at
    request.executed_at = executed_at
    request.cancel_until = cooling_off_deadline_utc(executed_at)
    request.reviewed_at = executed_at


def sign_topup_contract(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    party: str,
    typed_name: str,
    signature_png: str,
    accepted_terms: bool,
    actor_user_id: Optional[int] = None,
) -> InvestmentTopupRequest:
    del actor_user_id
    if request.status != "contract":
        raise ValueError("אפשר לחתום רק על חוזה שהוכן וממתין לחתימות")
    if not accepted_terms:
        raise ValueError("יש לאשר את תנאי החוזה לפני החתימה")
    name = (typed_name or "").strip()
    if len(name) < 2:
        raise ValueError("יש להקליד שם מלא לחתימה")
    png = _validate_signature_png(signature_png)
    role = (party or "").strip().lower()
    signed_at = utcnow()
    if role == "manager":
        if request.manager_signed_at:
            raise ValueError("המנהל כבר חתם על החוזה")
        request.manager_signed_at = signed_at
        request.manager_signed_name = name[:80]
        request.manager_signature_png = png
    elif role == "investor":
        if request.investor_signed_at:
            raise ValueError("המשקיע כבר חתם על החוזה")
        request.investor_signed_at = signed_at
        request.investor_signed_name = name[:80]
        request.investor_signature_png = png
    else:
        raise ValueError("צד חתימה לא תקין")

    if request.manager_signed_at and request.investor_signed_at:
        _execute_signed_contract(db, request=request)

    db.commit()
    loaded = _load_topup_request(db, request.id)
    assert loaded is not None
    return loaded


def reverse_topup_investment(
    db: Session,
    *,
    request: InvestmentTopupRequest,
    actor_user_id: Optional[int] = None,
    notes: Optional[str] = None,
    now: Optional[datetime] = None,
) -> InvestmentTopupRequest:
    now_utc = _as_utc(now or datetime.now(timezone.utc))
    if not _is_executed_topup(request.status):
        raise ValueError("אפשר לבטל השקעה רק אחרי ביצוע החוזה, ובתוך 3 ימי עסקים")
    if not request.cancel_until or now_utc > _as_utc(request.cancel_until):
        raise ValueError("חלון הביטול של 3 ימי עסקים הסתיים")
    plan = request.created_plan
    if plan is None and request.created_plan_id:
        plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == request.created_plan_id).first()
    if plan is None:
        raise ValueError("לא נמצא מסלול לביטול")
    if plan.status != "active":
        raise ValueError("המסלול כבר לא פעיל")

    plan.status = "completed"
    extra = (notes or "").strip() or "בוטל בחלון 3 ימי העסקים"
    plan.notes = f"{plan.notes} · {extra}".strip(" ·") if plan.notes else extra
    _close_plan_remaining_payments(db, plan)

    request.status = "reversed"
    request.reversed_at = utcnow()
    request.reversed_by_user_id = actor_user_id
    request.review_notes = extra
    db.commit()
    loaded = _load_topup_request(db, request.id)
    assert loaded is not None
    return loaded
