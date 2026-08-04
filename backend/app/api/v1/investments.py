from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.db.investment_session import get_investment_db, investment_engine
from app.db.investment_base import InvestmentBase
from app.models import investments as investment_models  # noqa: F401
from app.models.investments import Investor, InvestmentPlan, Payment, Quote
from app.schemas.investments import (
    DashboardOut,
    InvestorCreate,
    InvestorOut,
    InvestorUpdate,
    PaymentOut,
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
from app.services import investment_service as svc

router = APIRouter(prefix="/api/v1/investments", tags=["investments"])

InvestmentBase.metadata.create_all(bind=investment_engine)


def init_investment_db() -> None:
    from app.db.investment_session import InvestmentSessionLocal

    db = InvestmentSessionLocal()
    try:
        svc.seed_defaults(db)
    finally:
        db.close()


@router.post("/seed")
def seed(db: Session = Depends(get_investment_db)):
    return svc.seed_defaults(db)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_investment_db)):
    return svc.get_dashboard(db)


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_investment_db)):
    return svc.ensure_settings(db)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_investment_db)):
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
def list_investors(db: Session = Depends(get_investment_db)):
    investors = (
        db.query(Investor)
        .options(joinedload(Investor.plans))
        .order_by(Investor.is_manager.desc(), Investor.name)
        .all()
    )
    return [svc.serialize_investor(i) for i in investors]


@router.post("/investors", response_model=InvestorOut, status_code=201)
def create_investor(payload: InvestorCreate, db: Session = Depends(get_investment_db)):
    investor = Investor(**payload.model_dump())
    db.add(investor)
    db.commit()
    db.refresh(investor)
    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans))
        .filter(Investor.id == investor.id)
        .one()
    )
    return svc.serialize_investor(investor)


@router.patch("/investors/{investor_id}", response_model=InvestorOut)
def update_investor(
    investor_id: int, payload: InvestorUpdate, db: Session = Depends(get_investment_db)
):
    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans))
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
    db: Session = Depends(get_investment_db),
):
    query = db.query(InvestmentPlan).options(
        joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments)
    )
    if investor_id is not None:
        query = query.filter(InvestmentPlan.investor_id == investor_id)
    if status:
        query = query.filter(InvestmentPlan.status == status)
    plans = query.order_by(InvestmentPlan.start_date.desc()).all()
    return [svc.serialize_plan(p) for p in plans]


@router.post("/plans", response_model=PlanOut, status_code=201)
def create_plan(payload: PlanCreate, db: Session = Depends(get_investment_db)):
    investor = db.query(Investor).filter(Investor.id == payload.investor_id).first()
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")

    data = payload.model_dump(exclude={"generate_schedule"})
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
    plan_id: int, payload: PlanUpdate, db: Session = Depends(get_investment_db)
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
    db.commit()

    should_regen = payload.regenerate_schedule or any(
        field in data
        for field in (
            "principal",
            "monthly_rate_percent",
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


@router.post("/plans/{plan_id}/regenerate-schedule", response_model=list[PaymentOut])
def regenerate_schedule(plan_id: int, db: Session = Depends(get_investment_db)):
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
    db: Session = Depends(get_investment_db),
):
    query = db.query(Payment).options(joinedload(Payment.investor))
    if investor_id is not None:
        query = query.filter(Payment.investor_id == investor_id)
    if plan_id is not None:
        query = query.filter(Payment.plan_id == plan_id)
    if status:
        query = query.filter(Payment.status == status)
    if year is not None:
        query = query.filter(
            Payment.due_date >= date(year, 1, 1),
            Payment.due_date <= date(year, 12, 31),
        )
    payments = query.order_by(Payment.due_date.desc(), Payment.id.desc()).all()
    return [svc.serialize_payment(p) for p in payments]


@router.patch("/payments/{payment_id}", response_model=PaymentOut)
def update_payment(
    payment_id: int, payload: PaymentUpdate, db: Session = Depends(get_investment_db)
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
    if data.get("status") == "paid" and "paid_at" not in data:
        data["paid_at"] = date.today()
    if data.get("status") in {"scheduled", "skipped"}:
        data["paid_at"] = None
    for key, value in data.items():
        setattr(payment, key, value)
    db.commit()
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.get("/quotes", response_model=list[QuoteOut])
def list_quotes(db: Session = Depends(get_investment_db)):
    quotes = db.query(Quote).order_by(Quote.created_at.desc()).all()
    return [svc.serialize_quote(q) for q in quotes]


@router.post("/quotes", response_model=QuoteOut, status_code=201)
def create_quote(payload: QuoteCreate, db: Session = Depends(get_investment_db)):
    quote = Quote(**payload.model_dump())
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return svc.serialize_quote(quote)


@router.patch("/quotes/{quote_id}", response_model=QuoteOut)
def update_quote(
    quote_id: int, payload: QuoteUpdate, db: Session = Depends(get_investment_db)
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(quote, key, value)
    db.commit()
    db.refresh(quote)
    return svc.serialize_quote(quote)


@router.post("/quotes/{quote_id}/convert", response_model=PlanOut)
def convert_quote(
    quote_id: int, payload: QuoteConvert, db: Session = Depends(get_investment_db)
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
        monthly_rate_percent=quote.monthly_rate_percent,
        manager_fee_percent=quote.manager_fee_percent,
        start_date=payload.start_date,
        duration_months=quote.duration_months,
        notes=quote.notes,
        status="active",
    )
    db.add(plan)
    quote.status = "converted"
    quote.converted_investor_id = investor.id
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
