from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.investment_base import InvestmentBase as Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Investor(Base):
    __tablename__ = "investors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_manager: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    plans: Mapped[list["InvestmentPlan"]] = relationship(back_populates="investor")
    payments: Mapped[list["Payment"]] = relationship(back_populates="investor")
    topup_requests: Mapped[list["InvestmentTopupRequest"]] = relationship(
        back_populates="investor"
    )


class InvestmentPlan(Base):
    __tablename__ = "investment_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), nullable=False)
    principal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Principal used for savings accrual history — stays stable when savings → קרן.
    accrual_principal: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Sum of withdrawals + transfers out of the savings pot.
    savings_redeemed_total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Savings rolled in from closed tracks — counts toward available balance immediately.
    rollover_savings_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # monthly = החזר חודשי | savings = חיסכון ריבית דריבית | hybrid = משולב
    plan_type: Mapped[str] = mapped_column(String(32), nullable=False, default="monthly")
    monthly_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    savings_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    manager_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    duration_months: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    investor: Mapped["Investor"] = relationship(back_populates="plans")
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )
    savings_actions: Mapped[list["SavingsAction"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )
    successor_plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("investment_plans.id"), nullable=True
    )
    source_request: Mapped[Optional["InvestmentTopupRequest"]] = relationship(
        back_populates="created_plan",
        uselist=False,
        foreign_keys="InvestmentTopupRequest.created_plan_id",
    )


class SavingsAction(Base):
    """Withdraw savings or move savings into principal — audit trail."""

    __tablename__ = "savings_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("investment_plans.id"), nullable=False)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), nullable=False)
    # withdraw | transfer_to_principal
    action_type: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    principal_after: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    available_after: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    plan: Mapped["InvestmentPlan"] = relationship(back_populates="savings_actions")
    investor: Mapped["Investor"] = relationship()


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("plan_id", "month_number", name="uq_payments_plan_month"),
        UniqueConstraint("investor_id", "due_date", name="uq_payments_investor_due"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("investment_plans.id"), nullable=False)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), nullable=False)
    month_number: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    investor_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    manager_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="scheduled")
    paid_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    plan: Mapped["InvestmentPlan"] = relationship(back_populates="payments")
    investor: Mapped["Investor"] = relationship(back_populates="payments")


class Quote(Base):
    __tablename__ = "quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prospect_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    access_username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    access_password: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    principal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    plan_type: Mapped[str] = mapped_column(String(32), nullable=False, default="monthly")
    monthly_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    savings_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    manager_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    duration_months: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    converted_investor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("investors.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class InvestmentTopupRequest(Base):
    """Investor asks to add a track; manager offers a contract; both parties sign."""

    __tablename__ = "investment_topup_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # pending | cancelled | rejected | contract | executed | approved (legacy) | reversed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reviewed_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("investment_plans.id"), nullable=True
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancel_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reversed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reversed_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    contract_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    manager_party_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    offered_plan_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    offered_duration_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    offered_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    offered_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    offered_monthly_rate_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    offered_savings_rate_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    offered_management_fee_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    offered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    offered_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    offered_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    manager_signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    manager_signed_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    manager_signature_png: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    investor_signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    investor_signed_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    investor_signature_png: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    executed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    investor: Mapped["Investor"] = relationship(back_populates="topup_requests")
    created_plan: Mapped[Optional["InvestmentPlan"]] = relationship(
        back_populates="source_request",
        foreign_keys=[created_plan_id],
    )


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    default_monthly_rate_percent: Mapped[float] = mapped_column(Float, default=0.0)
    default_manager_fee_percent: Mapped[float] = mapped_column(Float, default=0.0)
    default_duration_months: Mapped[int] = mapped_column(Integer, default=12)
    currency_symbol: Mapped[str] = mapped_column(String(8), default="₪")
    manager_display_name: Mapped[str] = mapped_column(String(120), default="סהר")
    site_updating: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    site_updating_message: Mapped[str] = mapped_column(
        String(240),
        default="האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.",
        nullable=False,
    )
    slack_webhook_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    assistant_provider: Mapped[str] = mapped_column(String(32), default="gemini", nullable=False)
    assistant_api_key: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
