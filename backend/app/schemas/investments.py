from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_serializer


PlanStatus = Literal["active", "completed", "paused"]
PaymentStatus = Literal["scheduled", "paid", "skipped", "awaiting_confirmation"]
QuoteStatus = Literal["draft", "sent", "converted", "archived"]
PlanType = Literal["monthly", "savings", "hybrid"]


class InvestorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_manager: bool = False
    phone: Optional[str] = None
    notes: Optional[str] = None
    username: Optional[str] = Field(default=None, min_length=2, max_length=64)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    email: Optional[str] = None


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
    monthly_cash: float = 0
    monthly_savings: float = 0
    monthly_total: float = 0
    cash_rate_percent: float = 0
    savings_rate_percent: float = 0
    current_savings_balance: float = 0
    projected_savings_balance: float = 0
    active_plans_count: int = 0
    plan_types: list[str] = []
    months_in_program: int = 0
    plans_count: int = 0
    access_username: Optional[str] = None
    access_password: Optional[str] = None
    access_email: Optional[str] = None
    access_role: Optional[str] = None
    has_login: bool = False

    model_config = {"from_attributes": True}


class PlanCreate(BaseModel):
    investor_id: int
    principal: float = Field(ge=0)
    plan_type: PlanType = "monthly"
    monthly_rate_percent: float = Field(ge=0, default=0)
    savings_rate_percent: float = Field(ge=0, default=0)
    manager_fee_percent: float = Field(ge=0)
    start_date: date
    duration_months: int = Field(ge=1, le=120, default=12)
    notes: Optional[str] = None
    generate_schedule: bool = True


class PlanUpdate(BaseModel):
    principal: Optional[float] = Field(default=None, ge=0)
    plan_type: Optional[PlanType] = None
    monthly_rate_percent: Optional[float] = Field(default=None, ge=0)
    savings_rate_percent: Optional[float] = Field(default=None, ge=0)
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
    plan_type: str = "monthly"
    monthly_rate_percent: float
    savings_rate_percent: float = 0.0
    manager_fee_percent: Optional[float] = None
    start_date: date
    track_end_date: Optional[date] = None
    duration_months: int
    status: str
    notes: Optional[str] = None
    created_at: datetime
    monthly_investor_payout: float
    monthly_manager_fee: Optional[float] = None
    monthly_savings_accrual: float = 0.0
    projected_savings_balance: float = 0.0
    current_savings_balance: float = 0.0
    accrued_savings_balance: float = 0.0
    savings_redeemed_total: float = 0.0
    accrual_principal: float = 0.0
    successor_plan_id: Optional[int] = None
    source_request_id: Optional[int] = None
    cooling_off_until: Optional[datetime] = None
    cooling_off_days_left: int = 0
    can_cancel_investment: bool = False
    total_cash_payout: float = 0.0
    total_investor_payout: float
    total_manager_fee: Optional[float] = None
    annual_investor_payout: float
    months_elapsed: int
    months_remaining: int
    paid_count: int
    paid_investor_total: float
    paid_manager_total: Optional[float] = None

    model_config = {"from_attributes": True}

    @model_serializer(mode="wrap")
    def _omit_hidden_fees(self, serializer):
        data = serializer(self)
        if data.get("manager_fee_percent") is None:
            for key in (
                "manager_fee_percent",
                "monthly_manager_fee",
                "total_manager_fee",
                "paid_manager_total",
            ):
                data.pop(key, None)
        return data


class SavingsActionRequest(BaseModel):
    amount: float = Field(gt=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class SavingsActionOut(BaseModel):
    id: int
    action_type: str
    amount: float
    principal_after: Optional[float] = None
    available_after: Optional[float] = None
    created_at: datetime
    notes: Optional[str] = None


class SavingsActionResult(BaseModel):
    action: SavingsActionOut
    plan: PlanOut


class PlanSettleRequest(BaseModel):
    """Post-redeem questionnaire: close the track or open a successor."""

    action_type: Literal["withdraw", "transfer_to_principal"]
    amount: float = Field(gt=0)
    outcome: Literal["close_plan", "continue_new_track"]
    notes: Optional[str] = Field(default=None, max_length=500)
    # close_plan
    withdraw_remaining: bool = True
    # continue_new_track
    compound_savings: bool = True
    include_monthly_cash: bool = True
    monthly_rate_percent: float = Field(default=0, ge=0)
    savings_rate_percent: float = Field(default=0, ge=0)
    manager_fee_percent: Optional[float] = Field(default=None, ge=0)
    new_principal: Optional[float] = Field(default=None, gt=0)
    new_duration_months: int = Field(default=12, ge=1, le=120)
    new_start_date: Optional[date] = None


class PlanSettleResult(BaseModel):
    outcome: str
    action: SavingsActionOut
    residual_action: Optional[SavingsActionOut] = None
    closed_plan: PlanOut
    new_plan: Optional[PlanOut] = None


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
    phone: Optional[str] = Field(default=None, max_length=40)
    access_username: Optional[str] = Field(default=None, max_length=64)
    access_password: Optional[str] = Field(default=None, max_length=128)
    start_date: Optional[date] = None
    principal: float = Field(ge=0)
    plan_type: PlanType = "monthly"
    monthly_rate_percent: float = Field(ge=0, default=0)
    savings_rate_percent: float = Field(ge=0, default=0)
    manager_fee_percent: float = Field(ge=0)
    duration_months: int = Field(ge=1, le=120, default=12)
    notes: Optional[str] = None


class QuoteUpdate(BaseModel):
    prospect_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    access_username: Optional[str] = Field(default=None, max_length=64)
    access_password: Optional[str] = Field(default=None, max_length=128)
    start_date: Optional[date] = None
    principal: Optional[float] = Field(default=None, ge=0)
    plan_type: Optional[PlanType] = None
    monthly_rate_percent: Optional[float] = Field(default=None, ge=0)
    savings_rate_percent: Optional[float] = Field(default=None, ge=0)
    manager_fee_percent: Optional[float] = Field(default=None, ge=0)
    duration_months: Optional[int] = Field(default=None, ge=1, le=120)
    notes: Optional[str] = None
    status: Optional[QuoteStatus] = None


class QuoteConvert(BaseModel):
    start_date: Optional[date] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    username: Optional[str] = Field(default=None, min_length=2, max_length=64)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    email: Optional[str] = None

    @field_validator("username", "password", "phone", "notes", "email", mode="before")
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class QuoteOut(BaseModel):
    id: int
    prospect_name: str
    phone: Optional[str] = None
    access_username: Optional[str] = None
    access_password: Optional[str] = None
    start_date: Optional[date] = None
    principal: float
    plan_type: str = "monthly"
    monthly_rate_percent: float
    savings_rate_percent: float = 0.0
    manager_fee_percent: float
    duration_months: int
    notes: Optional[str] = None
    status: str
    converted_investor_id: Optional[int] = None
    created_at: datetime
    monthly_investor_payout: float
    monthly_manager_fee: float
    monthly_savings_accrual: float = 0.0
    projected_savings_balance: float = 0.0
    total_cash_payout: float = 0.0
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
    site_updating: Optional[bool] = None
    site_updating_message: Optional[str] = Field(default=None, max_length=240)
    slack_webhook_url: Optional[str] = Field(default=None, max_length=500)
    assistant_provider: Optional[str] = Field(default=None, max_length=32)
    assistant_api_key: Optional[str] = Field(default=None, max_length=200)


class SettingsOut(BaseModel):
    default_monthly_rate_percent: float
    default_manager_fee_percent: float
    default_duration_months: int
    currency_symbol: str
    manager_display_name: str
    site_updating: bool = False
    site_updating_message: str = "האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה."
    slack_webhook_url: Optional[str] = None
    assistant_provider: str = "gemini"
    assistant_api_key_set: bool = False
    assistant_api_key_hint: Optional[str] = None

    model_config = {"from_attributes": True}


class SiteStatusOut(BaseModel):
    site_updating: bool
    site_updating_message: str
    public_url: Optional[str] = None


class SlackAnnounceOut(BaseModel):
    sent: bool
    detail: str
    public_url: Optional[str] = None


class DashboardOut(BaseModel):
    scope_investor_id: Optional[int] = None
    total_principal: float
    monthly_investor_payouts: float
    monthly_cash_payouts: float = 0.0
    monthly_savings_accruals: float = 0.0
    monthly_investor_total: float = 0.0
    current_savings_total: float = 0.0
    projected_savings_total: float = 0.0
    monthly_manager_fees: float
    monthly_manager_own_payout: float
    monthly_manager_own_savings: float = 0.0
    monthly_manager_own_total: float = 0.0
    monthly_manager_total: float
    ytd_investor_paid: float
    ytd_manager_earned: float
    lifetime_investor_paid: float = 0.0
    lifetime_manager_earned: float = 0.0
    active_investors: int
    active_plans: int
    upcoming_payments: list[PaymentOut]
    recent_payments: list[PaymentOut]
    investors_summary: list[InvestorOut]


class PaymentTotalsOut(BaseModel):
    planned_investor: float
    paid_investor: float
    planned_manager: float
    paid_manager: float
    paid_count: int
    scheduled_count: int
    awaiting_count: int = 0
    skipped_count: int
    total_count: int
    savings_to_date: float = 0.0
    savings_to_track_end: float = 0.0


class PaymentReportOut(BaseModel):
    year: int
    available_years: list[int]
    yearly: PaymentTotalsOut
    lifetime: PaymentTotalsOut


class TopupRequestCreate(BaseModel):
    amount: float = Field(gt=0)
    notes: Optional[str] = Field(default=None, max_length=500)
    investor_id: Optional[int] = None


class TopupRequestDecision(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class TopupRequestApprove(BaseModel):
    principal: Optional[float] = Field(default=None, gt=0)
    plan_type: PlanType = "monthly"
    monthly_rate_percent: float = Field(ge=0, default=0)
    savings_rate_percent: float = Field(ge=0, default=0)
    manager_fee_percent: float = Field(ge=0)
    start_date: date
    duration_months: int = Field(ge=1, le=120, default=12)
    notes: Optional[str] = Field(default=None, max_length=500)
    generate_schedule: bool = True


class TopupRequestSign(BaseModel):
    typed_name: str = Field(min_length=2, max_length=80)
    signature_png: str = Field(min_length=40, max_length=900_000)
    accepted_terms: bool = False


class TopupRequestOut(BaseModel):
    id: int
    investor_id: int
    investor_name: str
    amount: float
    notes: Optional[str] = None
    status: str
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    created_plan_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    executed_at: Optional[datetime] = None
    cancel_until: Optional[datetime] = None
    reversed_at: Optional[datetime] = None
    can_cancel_request: bool = False
    can_reverse_investment: bool = False
    cooling_off_days_left: int = 0
    cooling_off_business_days: int = 3
    plan: Optional[PlanOut] = None
    manager_fee_percent: Optional[float] = None
    monthly_rate_percent: Optional[float] = None
    savings_rate_percent: Optional[float] = None
    plan_type: Optional[str] = None
    contract_number: Optional[str] = None
    manager_party_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    duration_months: Optional[int] = None
    offered_notes: Optional[str] = None
    monthly_investor_payout: Optional[float] = None
    monthly_savings_accrual: Optional[float] = None
    total_investor_payout: Optional[float] = None
    manager_signed: bool = False
    investor_signed: bool = False
    both_signed: bool = False
    manager_signed_at: Optional[datetime] = None
    manager_signed_name: Optional[str] = None
    investor_signed_at: Optional[datetime] = None
    investor_signed_name: Optional[str] = None
    manager_signature_png: Optional[str] = None
    investor_signature_png: Optional[str] = None
    contract_fully_signed: bool = False

    model_config = {"from_attributes": True}

    @model_serializer(mode="wrap")
    def _omit_manager_only(self, serializer):
        data = serializer(self)
        for key in (
            "manager_fee_percent",
            "monthly_rate_percent",
            "savings_rate_percent",
            "plan_type",
            "contract_number",
            "manager_party_name",
            "start_date",
            "end_date",
            "duration_months",
            "offered_notes",
            "monthly_investor_payout",
            "monthly_savings_accrual",
            "total_investor_payout",
            "manager_signed_at",
            "manager_signed_name",
            "investor_signed_at",
            "investor_signed_name",
            "manager_signature_png",
            "investor_signature_png",
            "executed_at",
        ):
            if data.get(key) is None:
                data.pop(key, None)
        return data
