from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, backref

from app.db.investment_base import InvestmentBase as Base
from app.models.investments import utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    access_password: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="investor")
    must_reset_password: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    password_set_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    investor = relationship("Investor", backref=backref("user", uselist=False))
    reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    password_reset_requests: Mapped[list["PasswordResetRequest"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="PasswordResetRequest.user_id",
    )


class PasswordResetToken(Base):
    """Legacy invite/forgot tokens — kept for DB compatibility; unused by new auth."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, default="invite")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped["User"] = relationship(back_populates="reset_tokens")


class PasswordResetRequest(Base):
    """Client asks manager to reset password — no self-service reset."""

    __tablename__ = "password_reset_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    note: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    user: Mapped["User"] = relationship(
        back_populates="password_reset_requests",
        foreign_keys=[user_id],
    )


class LoginAlert(Base):
    __tablename__ = "login_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    logged_in_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ActivityEvent(Base):
    """Unified activity + notification stream for managers (tracking + alerts)."""

    __tablename__ = "activity_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    actor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    investor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("investors.id", ondelete="SET NULL"), nullable=True
    )
    investor_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    entity_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    href: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    meta_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EmailOutbox(Base):
    __tablename__ = "email_outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    to_email: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False, default="generic")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    meta_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
