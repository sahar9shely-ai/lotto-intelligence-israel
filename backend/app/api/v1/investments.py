from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db, investment_engine
from app.models import auth as auth_models  # noqa: F401
from app.models import investments as investment_models  # noqa: F401
from app.models.auth import User
from app.models.investments import Investor, InvestmentPlan, Payment, Quote
from app.schemas.investments import (
    DashboardOut,
    InvestorCreate,
    InvestorOut,
    InvestorUpdate,
    PaymentOut,
    PaymentReportOut,
    PaymentUpdate,
    PlanCreate,
    PlanOut,
    PlanUpdate,
    QuoteConvert,
    QuoteCreate,
    QuoteOut,
    QuoteUpdate,
    SettingsOut,
    SettingsUpdate,
)
from app.security.auth import get_current_user, is_manager, require_manager
from app.services import auth_service as auth_svc
from app.services import investment_service as svc

router = APIRouter(prefix="/api/v1/investments", tags=["investments"])

InvestmentBase.metadata.create_all(bind=investment_engine)


def init_investment_db() -> None:
    from app.db.investment_session import InvestmentSessionLocal
    from app.db.schema_migrate import ensure_schema

    ensure_schema(investment_engine)

    db = InvestmentSessionLocal()
    try:
        svc.seed_defaults(db)
        svc.repair_reporting_year_plans(db)
    finally:
        db.close()


def _scope_investor_id(user: User, requested: Optional[int] = None) -> Optional[int]:
    if is_manager(user):
        return requested
    if requested is not None and requested != user.investor_id:
        raise HTTPException(status_code=403, detail="אין גישה לנתונים של משקיע אחר")
    return user.investor_id


@router.post("/seed")
def seed(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return svc.seed_defaults(db)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = None if is_manager(user) else user.investor_id
    return svc.get_dashboard(db, investor_id=scoped)


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return svc.ensure_settings(db)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    settings = svc.ensure_settings(db)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(settings, key, value)
    if "manager_display_name" in data:
        manager = db.query(Investor).filter(Investor.is_manager.is_(True)).first()
        if manager:
            manager.name = data["manager_display_name"]
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/investors", response_model=list[InvestorOut])
def list_investors(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    query = db.query(Investor).options(joinedload(Investor.plans), joinedload(Investor.user))
    if not is_manager(user):
        query = query.filter(Investor.id == user.investor_id)
    investors = query.order_by(Investor.is_manager.desc(), Investor.name).all()
    return [svc.serialize_investor(i) for i in investors]


@router.post("/investors", response_model=InvestorOut, status_code=201)
def create_investor(
    payload: InvestorCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    data = payload.model_dump(exclude={"email", "username", "password"})
    investor = Investor(**data)
    db.add(investor)
    db.flush()

    try:
        auth_svc.ensure_user_for_investor(
            db,
            investor,
            username=payload.username,
            email=payload.email.strip() if payload.email else None,
            password=payload.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans), joinedload(Investor.user))
        .filter(Investor.id == investor.id)
        .one()
    )
    return svc.serialize_investor(investor)


@router.patch("/investors/{investor_id}", response_model=InvestorOut)
def update_investor(
    investor_id: int,
    payload: InvestorUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if not is_manager(user) and investor_id != user.investor_id:
        raise HTTPException(status_code=403, detail="אין הרשאה")
    # Investors may only update phone/notes on themselves
    if not is_manager(user):
        allowed = payload.model_dump(exclude_unset=True)
        if any(k not in {"phone", "notes"} for k in allowed):
            raise HTTPException(status_code=403, detail="ניתן לעדכן רק טלפון והערות")

    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans), joinedload(Investor.user))
        .filter(Investor.id == investor_id)
        .first()
    )
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(investor, key, value)
    db.commit()
    db.refresh(investor)
    return svc.serialize_investor(investor)


@router.get("/plans", response_model=list[PlanOut])
def list_plans(
    investor_id: Optional[int] = None,
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    query = db.query(InvestmentPlan).options(
        joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments)
    )
    if scoped is not None:
        query = query.filter(InvestmentPlan.investor_id == scoped)
    if status:
        query = query.filter(InvestmentPlan.status == status)
    plans = query.order_by(InvestmentPlan.start_date.desc()).all()
    return [svc.serialize_plan(p) for p in plans]


@router.post("/plans", response_model=PlanOut, status_code=201)
def create_plan(
    payload: PlanCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    investor = db.query(Investor).filter(Investor.id == payload.investor_id).first()
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")

    data = payload.model_dump(exclude={"generate_schedule"})
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        data.get("plan_type") or "monthly",
        data.get("monthly_rate_percent") or 0,
        data.get("savings_rate_percent") or 0,
    )
    data["plan_type"] = kind
    data["monthly_rate_percent"] = monthly_rate
    data["savings_rate_percent"] = savings_rate
    plan = InvestmentPlan(**data)
    db.add(plan)
    db.commit()
    db.refresh(plan)

    if payload.generate_schedule:
        svc.generate_payment_schedule(db, plan)

    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan.id)
        .one()
    )
    return svc.serialize_plan(plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int,
    payload: PlanUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    data = payload.model_dump(exclude_unset=True, exclude={"regenerate_schedule"})
    for key, value in data.items():
        setattr(plan, key, value)
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    plan.plan_type = kind
    plan.monthly_rate_percent = monthly_rate
    plan.savings_rate_percent = savings_rate
    db.commit()

    should_regen = payload.regenerate_schedule or any(
        field in data
        for field in (
            "principal",
            "plan_type",
            "monthly_rate_percent",
            "savings_rate_percent",
            "manager_fee_percent",
            "start_date",
            "duration_months",
        )
    )
    if should_regen:
        svc.generate_payment_schedule(db, plan)

    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan_id)
        .one()
    )
    return svc.serialize_plan(plan)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(
    plan_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    db.delete(plan)
    db.commit()
    return None


@router.post("/remove-from-calendar-year")
def remove_from_calendar_year(
    year: int = Query(...),
    investor_id: int = Query(...),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Remove an investor from a reporting year so they no longer appear in that year's report."""
    return svc.remove_investor_from_calendar_year(db, year=year, investor_id=investor_id)


@router.post("/plans/{plan_id}/regenerate-schedule", response_model=list[PaymentOut])
def regenerate_schedule(
    plan_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    svc.generate_payment_schedule(db, plan)
    payments = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.plan_id == plan_id)
        .order_by(Payment.month_number)
        .all()
    )
    return [svc.serialize_payment(p) for p in payments]


@router.get("/payments", response_model=list[PaymentOut])
def list_payments(
    investor_id: Optional[int] = None,
    plan_id: Optional[int] = None,
    status: Optional[str] = None,
    year: Optional[int] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    query = db.query(Payment).options(joinedload(Payment.investor))
    if scoped is not None:
        query = query.filter(Payment.investor_id == scoped)
    if plan_id is not None:
        query = query.filter(Payment.plan_id == plan_id)
    if status:
        query = query.filter(Payment.status == status)
    if year is not None:
        query = query.filter(
            Payment.due_date >= date(year, 1, 1),
            Payment.due_date <= date(year, 12, 31),
        )
        payments = query.order_by(Payment.due_date.asc(), Payment.id.asc()).all()
    else:
        payments = query.order_by(Payment.due_date.desc(), Payment.id.desc()).all()

    # Safety net: never return two rows for the same investor on the same due date.
    priority = {
        "paid": 3,
        "awaiting_confirmation": 2,
        "scheduled": 1,
        "skipped": 0,
    }
    unique: dict[tuple[int, date], Payment] = {}
    for payment in payments:
        key = (payment.investor_id, payment.due_date)
        prior = unique.get(key)
        if prior is None or priority.get(payment.status, 0) > priority.get(prior.status, 0):
            unique[key] = payment
    ordered = sorted(
        unique.values(),
        key=lambda p: (p.due_date, p.id),
        reverse=year is None,
    )
    return [svc.serialize_payment(p) for p in ordered]


@router.get("/payment-report", response_model=PaymentReportOut)
def payment_report(
    year: int = Query(...),
    investor_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    return svc.get_payment_report(db, year=year, investor_id=scoped)


@router.post("/open-calendar-year")
def open_calendar_year(
    year: int = Query(...),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Open a Jan–Dec reporting year for all investors who already have a plan."""
    try:
        return svc.open_calendar_year_plans(db, year=year)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/payments/mark-year-paid")
def mark_year_paid(
    year: int = Query(...),
    investor_id: Optional[int] = None,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Send confirmation requests for all scheduled payments in a calendar year."""
    return svc.mark_year_payments_paid(
        db, year=year, investor_id=investor_id, actor=user
    )


@router.post("/align-calendar-year")
def align_calendar_year(
    year: Optional[int] = Query(default=None),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Align active plans to 1 Jan–Dec of the calendar year."""
    return svc.align_plans_to_calendar_year(db, year=year)


@router.patch("/payments/{payment_id}", response_model=PaymentOut)
def update_payment(
    payment_id: int,
    payload: PaymentUpdate,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    payment = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    data = payload.model_dump(exclude_unset=True)

    # Manager "mark paid" becomes a confirmation request to the investor.
    if data.get("status") == "paid":
        svc.request_payment_confirmation(db, payment=payment, actor=user)
        db.refresh(payment)
        return svc.serialize_payment(payment)

    if data.get("status") in {"scheduled", "skipped"}:
        data["paid_at"] = None
    for key, value in data.items():
        setattr(payment, key, value)
    db.commit()
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.post("/payments/{payment_id}/confirm", response_model=PaymentOut)
def confirm_payment(
    payment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    payment = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    try:
        svc.confirm_payment(db, payment=payment, actor=user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.post("/payments/{payment_id}/reject", response_model=PaymentOut)
def reject_payment(
    payment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    payment = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    try:
        svc.reject_payment_confirmation(db, payment=payment, actor=user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.get("/quotes", response_model=list[QuoteOut])
def list_quotes(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quotes = db.query(Quote).order_by(Quote.created_at.desc()).all()
    return [svc.serialize_quote(q) for q in quotes]


@router.post("/quotes", response_model=QuoteOut, status_code=201)
def create_quote(
    payload: QuoteCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    data = payload.model_dump()
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        data.get("plan_type") or "monthly",
        data.get("monthly_rate_percent") or 0,
        data.get("savings_rate_percent") or 0,
    )
    data["plan_type"] = kind
    data["monthly_rate_percent"] = monthly_rate
    data["savings_rate_percent"] = savings_rate
    quote = Quote(**data)
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return svc.serialize_quote(quote)


@router.patch("/quotes/{quote_id}", response_model=QuoteOut)
def update_quote(
    quote_id: int,
    payload: QuoteUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(quote, key, value)
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        getattr(quote, "plan_type", None) or "monthly",
        quote.monthly_rate_percent,
        getattr(quote, "savings_rate_percent", 0.0) or 0.0,
    )
    quote.plan_type = kind
    quote.monthly_rate_percent = monthly_rate
    quote.savings_rate_percent = savings_rate
    db.commit()
    db.refresh(quote)
    return svc.serialize_quote(quote)


@router.delete("/quotes/{quote_id}", status_code=204)
def delete_quote(
    quote_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote.status == "converted":
        raise HTTPException(
            status_code=400,
            detail="לא ניתן למחוק הצעה שכבר הומרה למשקיע",
        )
    db.delete(quote)
    db.commit()
    return None


@router.post("/quotes/{quote_id}/convert", response_model=PlanOut)
def convert_quote(
    quote_id: int,
    payload: QuoteConvert,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote.status == "converted":
        raise HTTPException(status_code=400, detail="Quote already converted")

    investor = Investor(
        name=quote.prospect_name,
        phone=payload.phone,
        notes=payload.notes or quote.notes,
    )
    db.add(investor)
    db.flush()

    plan = InvestmentPlan(
        investor_id=investor.id,
        principal=quote.principal,
        plan_type=getattr(quote, "plan_type", None) or "monthly",
        monthly_rate_percent=quote.monthly_rate_percent,
        savings_rate_percent=getattr(quote, "savings_rate_percent", 0.0) or 0.0,
        manager_fee_percent=quote.manager_fee_percent,
        start_date=payload.start_date,
        duration_months=quote.duration_months,
        notes=quote.notes,
        status="active",
    )
    db.add(plan)
    quote.status = "converted"
    quote.converted_investor_id = investor.id
    auth_svc.ensure_user_for_investor(
        db,
        investor,
        username=payload.username,
        email=payload.email,
        password=payload.password,
    )
    db.commit()
    db.refresh(plan)

    svc.generate_payment_schedule(db, plan)
    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan.id)
        .one()
    )
    return svc.serialize_plan(plan)
