import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class GameRule(Base):
    __tablename__ = "game_rules"

    game_rule_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    game_code: Mapped[str] = mapped_column(String(32), nullable=False)
    game_variant: Mapped[str] = mapped_column(String(32), nullable=False)
    rule_version: Mapped[str] = mapped_column(String(32), nullable=False)
    effective_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    effective_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    regular_min_value: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    regular_max_value: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    regular_count: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    strong_min_value: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    strong_max_value: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    strong_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    draws: Mapped[list["LotteryDraw"]] = relationship(back_populates="game_rule")

    __table_args__ = (
        UniqueConstraint("game_code", "game_variant", "rule_version", name="uq_game_rules_identity"),
        CheckConstraint(
            "effective_end_date IS NULL OR effective_end_date >= effective_start_date",
            name="ck_game_rules_effective_range",
        ),
        CheckConstraint("regular_min_value >= 1", name="ck_game_rules_regular_min"),
        CheckConstraint("regular_max_value > regular_min_value", name="ck_game_rules_regular_max"),
        CheckConstraint("regular_count > 0", name="ck_game_rules_regular_count"),
        CheckConstraint(
            "(strong_count = 0 AND strong_min_value IS NULL AND strong_max_value IS NULL) "
            "OR (strong_count > 0 AND strong_min_value IS NOT NULL AND strong_max_value IS NOT NULL "
            "AND strong_max_value > strong_min_value)",
            name="ck_game_rules_strong_config",
        ),
        Index(
            "ix_game_rules_lookup",
            "game_code",
            "game_variant",
            "effective_start_date",
        ),
    )


class DataImportLog(Base):
    __tablename__ = "data_import_logs"

    import_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    source_system: Mapped[str] = mapped_column(String(64), nullable=False)
    source_object: Mapped[str] = mapped_column(String(256), nullable=False)
    source_checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    records_received: Mapped[int] = mapped_column(Integer, nullable=False)
    records_valid: Mapped[int] = mapped_column(Integer, nullable=False)
    records_quarantined: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    triggered_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    draws: Mapped[list["LotteryDraw"]] = relationship(back_populates="import_log")
    rejections: Mapped[list["DataImportRejection"]] = relationship(back_populates="import_log")
    snapshot_lineage: Mapped[list["SnapshotImportLineage"]] = relationship(back_populates="import_log")

    __table_args__ = (
        UniqueConstraint("run_id", "source_system", "source_object", name="uq_import_run_source"),
        CheckConstraint("records_received >= 0", name="ck_import_records_received"),
        CheckConstraint("records_valid >= 0", name="ck_import_records_valid"),
        CheckConstraint("records_quarantined >= 0", name="ck_import_records_quarantined"),
        CheckConstraint(
            "status IN ('running','succeeded','partial','failed')",
            name="ck_import_status",
        ),
        CheckConstraint(
            "ended_at_utc IS NULL OR ended_at_utc >= started_at_utc",
            name="ck_import_time_range",
        ),
        Index("ix_import_status_time", "status", "started_at_utc"),
        Index("ix_import_checksum", "source_checksum_sha256"),
    )


class LotteryDraw(Base):
    __tablename__ = "lottery_draws"

    draw_revision_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    draw_uid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4)
    import_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("data_import_logs.import_id", ondelete="RESTRICT"), nullable=False
    )
    game_rule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("game_rules.game_rule_id", ondelete="RESTRICT"), nullable=False
    )
    supersedes_draw_revision_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("lottery_draws.draw_revision_id", ondelete="RESTRICT"),
        nullable=True,
    )
    draw_number: Mapped[int] = mapped_column(Integer, nullable=False)
    draw_date: Mapped[date] = mapped_column(Date, nullable=False)
    draw_timestamp_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    source_system: Mapped[str] = mapped_column(String(64), nullable=False)
    source_record_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    jackpot_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(16, 2), nullable=True)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, server_default=text("'ILS'"))
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    effective_from_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    effective_to_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    record_checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    ingested_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    game_rule: Mapped["GameRule"] = relationship(back_populates="draws")
    import_log: Mapped["DataImportLog"] = relationship(back_populates="draws")
    numbers: Mapped[list["DrawNumber"]] = relationship(back_populates="draw", cascade="all, delete-orphan")
    strong_numbers: Mapped[list["StrongNumber"]] = relationship(back_populates="draw", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint(
            "source_system",
            "source_record_id",
            "source_revision",
            name="uq_draw_source_revision",
        ),
        CheckConstraint("draw_number > 0", name="ck_draw_number_positive"),
        CheckConstraint("source_revision >= 1", name="ck_draw_source_revision_positive"),
        CheckConstraint("jackpot_amount IS NULL OR jackpot_amount >= 0", name="ck_draw_jackpot_non_negative"),
        CheckConstraint(
            "effective_to_utc IS NULL OR effective_to_utc > effective_from_utc",
            name="ck_draw_effective_range",
        ),
        Index("ix_draw_uid", "draw_uid", "source_revision"),
        Index("ix_draw_lookup", "game_rule_id", "draw_date"),
        Index(
            "ix_draw_current_lookup",
            "game_rule_id",
            "draw_date",
            "draw_number",
            postgresql_where=text("is_current = true"),
        ),
        Index(
            "uq_draw_current_version",
            "game_rule_id",
            "draw_date",
            "draw_number",
            unique=True,
            postgresql_where=text("is_current = true"),
        ),
    )


class DrawNumber(Base):
    __tablename__ = "draw_numbers"

    draw_number_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    draw_revision_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lottery_draws.draw_revision_id", ondelete="CASCADE"), nullable=False
    )
    position_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    number_value: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    draw: Mapped["LotteryDraw"] = relationship(back_populates="numbers")

    __table_args__ = (
        UniqueConstraint("draw_revision_id", "position_no", name="uq_draw_regular_position"),
        UniqueConstraint("draw_revision_id", "number_value", name="uq_draw_regular_value"),
        CheckConstraint("position_no >= 1", name="ck_draw_numbers_position_min"),
        CheckConstraint("number_value >= 1", name="ck_draw_numbers_value_min"),
        Index("ix_draw_numbers_value", "number_value", "draw_revision_id"),
    )


class StrongNumber(Base):
    __tablename__ = "strong_numbers"

    strong_number_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    draw_revision_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lottery_draws.draw_revision_id", ondelete="CASCADE"), nullable=False
    )
    position_no: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    strong_value: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    draw: Mapped["LotteryDraw"] = relationship(back_populates="strong_numbers")

    __table_args__ = (
        UniqueConstraint("draw_revision_id", "position_no", name="uq_draw_strong_position"),
        UniqueConstraint("draw_revision_id", "strong_value", name="uq_draw_strong_value"),
        CheckConstraint("position_no = 1", name="ck_strong_single_slot_phase1"),
        CheckConstraint("strong_value >= 1", name="ck_strong_value_min"),
        Index("ix_strong_value", "strong_value", "draw_revision_id"),
    )


class AnalyticsSnapshot(Base):
    __tablename__ = "analytics_snapshots"

    snapshot_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_code: Mapped[str] = mapped_column(String(64), nullable=False)
    game_rule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("game_rules.game_rule_id", ondelete="RESTRICT"), nullable=False
    )
    snapshot_type: Mapped[str] = mapped_column(String(24), nullable=False)
    window_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    window_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    algorithm_version: Mapped[str] = mapped_column(String(32), nullable=False)
    engine_build_id: Mapped[str] = mapped_column(String(64), nullable=False)
    execution_manifest_jsonb: Mapped[dict] = mapped_column(JSONB, nullable=False)
    dataset_hash_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    source_watermark_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    quality_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    published_at_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    number_frequency_rows: Mapped[list["NumberFrequency"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )
    pair_frequency_rows: Mapped[list["PairFrequency"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )
    import_lineage: Mapped[list["SnapshotImportLineage"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("snapshot_code", name="uq_snapshot_code"),
        UniqueConstraint(
            "game_rule_id",
            "window_start_date",
            "window_end_date",
            "algorithm_version",
            "dataset_hash_sha256",
            name="uq_snapshot_content",
        ),
        CheckConstraint("window_end_date >= window_start_date", name="ck_snapshot_window"),
        CheckConstraint("quality_score >= 0 AND quality_score <= 100", name="ck_snapshot_quality"),
        CheckConstraint(
            "status IN ('draft','published','superseded','failed')",
            name="ck_snapshot_status",
        ),
        Index("ix_snapshot_publish", "status", "published_at_utc"),
        Index(
            "uq_snapshot_published_once",
            "game_rule_id",
            "window_start_date",
            "window_end_date",
            "algorithm_version",
            unique=True,
            postgresql_where=text("status = 'published'"),
        ),
    )


class SnapshotImportLineage(Base):
    __tablename__ = "snapshot_import_lineage"

    snapshot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analytics_snapshots.snapshot_id", ondelete="CASCADE"), primary_key=True
    )
    import_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("data_import_logs.import_id", ondelete="RESTRICT"), primary_key=True
    )
    linked_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    snapshot: Mapped["AnalyticsSnapshot"] = relationship(back_populates="import_lineage")
    import_log: Mapped["DataImportLog"] = relationship(back_populates="snapshot_lineage")


class NumberFrequency(Base):
    __tablename__ = "number_frequency"

    snapshot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analytics_snapshots.snapshot_id", ondelete="CASCADE"), primary_key=True
    )
    number_value: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    draw_count: Mapped[int] = mapped_column(Integer, nullable=False)
    appearance_count: Mapped[int] = mapped_column(Integer, nullable=False)
    frequency_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    recency_days: Mapped[int] = mapped_column(Integer, nullable=False)
    z_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 5), nullable=True)
    quality_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    snapshot: Mapped["AnalyticsSnapshot"] = relationship(back_populates="number_frequency_rows")

    __table_args__ = (
        CheckConstraint("number_value >= 1", name="ck_number_frequency_value_min"),
        CheckConstraint("draw_count >= 0", name="ck_number_frequency_draw_count"),
        CheckConstraint("appearance_count >= 0", name="ck_number_frequency_appearance_count"),
        CheckConstraint("frequency_pct >= 0 AND frequency_pct <= 100", name="ck_number_frequency_pct"),
        CheckConstraint("recency_days >= 0", name="ck_number_frequency_recency"),
        CheckConstraint("quality_score >= 0 AND quality_score <= 100", name="ck_number_frequency_quality"),
        Index("ix_number_frequency_rank", "snapshot_id", "frequency_pct"),
        Index("ix_number_frequency_recency", "snapshot_id", "recency_days", "frequency_pct"),
    )


class PairFrequency(Base):
    __tablename__ = "pair_frequency"

    snapshot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("analytics_snapshots.snapshot_id", ondelete="CASCADE"), primary_key=True
    )
    number_a: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    number_b: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    cooccurrence_count: Mapped[int] = mapped_column(Integer, nullable=False)
    support_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    lift_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 6), nullable=True)
    quality_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    snapshot: Mapped["AnalyticsSnapshot"] = relationship(back_populates="pair_frequency_rows")

    __table_args__ = (
        CheckConstraint("number_a >= 1", name="ck_pair_frequency_number_a_min"),
        CheckConstraint("number_b >= 1", name="ck_pair_frequency_number_b_min"),
        CheckConstraint("number_a < number_b", name="ck_pair_frequency_order"),
        CheckConstraint("cooccurrence_count >= 0", name="ck_pair_frequency_cooccurrence"),
        CheckConstraint("support_pct >= 0 AND support_pct <= 100", name="ck_pair_frequency_support"),
        CheckConstraint("lift_score IS NULL OR lift_score >= 0", name="ck_pair_frequency_lift"),
        CheckConstraint("quality_score >= 0 AND quality_score <= 100", name="ck_pair_frequency_quality"),
        Index("ix_pair_frequency_support", "snapshot_id", "support_pct"),
    )


class DataImportRejection(Base):
    __tablename__ = "data_import_rejections"

    rejection_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    import_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("data_import_logs.import_id", ondelete="CASCADE"), nullable=False
    )
    source_pointer: Mapped[str] = mapped_column(String(256), nullable=False)
    rejection_code: Mapped[str] = mapped_column(String(64), nullable=False)
    rejection_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rejected_payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    resolution_status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'open'"))
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    import_log: Mapped["DataImportLog"] = relationship(back_populates="rejections")

    __table_args__ = (
        CheckConstraint(
            "resolution_status IN ('open','resolved','ignored')",
            name="ck_import_rejection_resolution_status",
        ),
        Index("ix_import_rejections_import", "import_id", "created_at_utc"),
        Index("ix_import_rejections_code", "rejection_code"),
    )


class SystemAuditLog(Base):
    __tablename__ = "system_audit_logs"

    audit_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_ts_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    before_state: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    after_state: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), nullable=False)
    retention_until_date: Mapped[date] = mapped_column(Date, nullable=False)

    __table_args__ = (
        CheckConstraint("actor_type IN ('user','service','system')", name="ck_audit_actor_type"),
        CheckConstraint("result IN ('success','failure','denied')", name="ck_audit_result"),
        CheckConstraint("severity IN ('info','warn','error','critical')", name="ck_audit_severity"),
        Index("ix_audit_event_time", "event_ts_utc"),
        Index("ix_audit_actor_time", "actor_id", "event_ts_utc"),
        Index("ix_audit_entity_time", "entity_type", "entity_id", "event_ts_utc"),
        Index("ix_audit_request", "request_id"),
    )

