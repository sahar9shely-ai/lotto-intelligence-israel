"""Opted-in browser subscriptions and a transactional web-push outbox."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.investment_base import InvestmentBase
from app.models.investments import utcnow


class PushSubscription(InvestmentBase):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(100), nullable=False)
    auth: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class PushNotice(InvestmentBase):
    __tablename__ = "push_notices"
    __table_args__ = (UniqueConstraint("event_key", "user_id", name="uq_push_notice_event_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_key: Mapped[str] = mapped_column(String(150), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # Payment request revision ensures a rejected/reissued request is a new event.
    entity_revision: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class PushDelivery(InvestmentBase):
    __tablename__ = "push_deliveries"
    __table_args__ = (
        UniqueConstraint("notice_id", "subscription_id", name="uq_push_delivery_notice_subscription"),
        Index("ix_push_deliveries_ready", "status", "next_attempt_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    notice_id: Mapped[int] = mapped_column(ForeignKey("push_notices.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("push_subscriptions.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    claim_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Only fixed codes are retained; provider errors can contain secret endpoints.
    last_error_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
