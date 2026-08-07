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


class InvestmentPlan(Base):
    __tablename__ = "investment_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), nullable=False)
    principal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
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
    principal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    plan_type: Mapped[str] = mapped_column(String(32), nullable=False, default="monthly")
    monthly_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    savings_rate_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    manager_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    duration_months: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    converted_investor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("investors.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


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
