from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


PlanStatus = Literal["active", "completed", "paused"]
PaymentStatus = Literal["scheduled", "paid", "skipped"]
QuoteStatus = Literal["draft", "sent", "converted", "archived"]


class InvestorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_manager: bool = False
    phone: Optional[str] = None
    notes: Optional[str] = None


class InvestorUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_manager: Optional[bool] = None


class InvestorOut(BaseModel):
    id: int
    name: str
    is_manager: bool
    phone: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    active_principal: float = 0
    monthly_payout: float = 0
    months_in_program: int = 0
    plans_count: int = 0

    model_config = {"from_attributes": True}


class PlanCreate(BaseModel):
    investor_id: int
    principal: float = Field(ge=0)
    monthly_rate_percent: float = Field(ge=0)
    manager_fee_percent: float = Field(ge=0)
    start_date: date
    duration_months: int = Field(ge=1, le=120, default=12)
    notes: Optional[str] = None
    generate_schedule: bool = True


class PlanUpdate(BaseModel):
    principal: Optional[float] = Field(default=None, ge=0)
    monthly_rate_percent: Optional[float] = Field(default=None, ge=0)
    manager_fee_percent: Optional[float] = Field(default=None, ge=0)
    start_date: Optional[date] = None
    duration_months: Optional[int] = Field(default=None, ge=1, le=120)
    status: Optional[PlanStatus] = None
    notes: Optional[str] = None
    regenerate_schedule: bool = False


class PlanOut(BaseModel):
    id: int
    investor_id: int
    investor_name: str
    principal: float
    monthly_rate_percent: float
    manager_fee_percent: float
    start_date: date
    duration_months: int
    status: str
    notes: Optional[str] = None
    created_at: datetime
    monthly_investor_payout: float
    monthly_manager_fee: float
    total_investor_payout: float
    total_manager_fee: float
    annual_investor_payout: float
    months_elapsed: int
    months_remaining: int
    paid_count: int
    paid_investor_total: float
    paid_manager_total: float

    model_config = {"from_attributes": True}


class PaymentUpdate(BaseModel):
    status: Optional[PaymentStatus] = None
    paid_at: Optional[date] = None
    investor_amount: Optional[float] = Field(default=None, ge=0)
    manager_amount: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    plan_id: int
    investor_id: int
    investor_name: str
    month_number: int
    due_date: date
    investor_amount: float
    manager_amount: float
    status: str
    paid_at: Optional[date] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class QuoteCreate(BaseModel):
    prospect_name: str = Field(min_length=1, max_length=120)
    principal: float = Field(ge=0)
    monthly_rate_percent: float = Field(ge=0)
    manager_fee_percent: float = Field(ge=0)
    duration_months: int = Field(ge=1, le=120, default=12)
    notes: Optional[str] = None


class QuoteUpdate(BaseModel):
    prospect_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    principal: Optional[float] = Field(default=None, ge=0)
    monthly_rate_percent: Optional[float] = Field(default=None, ge=0)
    manager_fee_percent: Optional[float] = Field(default=None, ge=0)
    duration_months: Optional[int] = Field(default=None, ge=1, le=120)
    notes: Optional[str] = None
    status: Optional[QuoteStatus] = None


class QuoteConvert(BaseModel):
    start_date: date
    phone: Optional[str] = None
    notes: Optional[str] = None


class QuoteOut(BaseModel):
    id: int
    prospect_name: str
    principal: float
    monthly_rate_percent: float
    manager_fee_percent: float
    duration_months: int
    notes: Optional[str] = None
    status: str
    converted_investor_id: Optional[int] = None
    created_at: datetime
    monthly_investor_payout: float
    monthly_manager_fee: float
    total_investor_payout: float
    total_manager_fee: float
    annual_investor_payout: float

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    default_monthly_rate_percent: Optional[float] = Field(default=None, ge=0)
    default_manager_fee_percent: Optional[float] = Field(default=None, ge=0)
    default_duration_months: Optional[int] = Field(default=None, ge=1, le=120)
    currency_symbol: Optional[str] = None
    manager_display_name: Optional[str] = None


class SettingsOut(BaseModel):
    default_monthly_rate_percent: float
    default_manager_fee_percent: float
    default_duration_months: int
    currency_symbol: str
    manager_display_name: str

    model_config = {"from_attributes": True}


class DashboardOut(BaseModel):
    total_principal: float
    monthly_investor_payouts: float
    monthly_manager_fees: float
    monthly_manager_own_payout: float
    monthly_manager_total: float
    ytd_investor_paid: float
    ytd_manager_earned: float
    active_investors: int
    active_plans: int
    upcoming_payments: list[PaymentOut]
    recent_payments: list[PaymentOut]
    investors_summary: list[InvestorOut]
