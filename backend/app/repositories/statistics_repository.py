from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Sequence

from sqlalchemy import Select, select, update
from sqlalchemy.orm import Session, selectinload

from app.models.phase1 import (
    AnalyticsSnapshot,
    DrawNumber,
    GameRule,
    LotteryDraw,
    NumberFrequency,
    PairFrequency,
    SnapshotImportLineage,
    StrongNumber,
    SystemAuditLog,
)


@dataclass
class NumberFrequencyRow:
    number_value: int
    draw_count: int
    appearance_count: int
    frequency_pct: Decimal
    recency_days: int
    z_score: Optional[Decimal]
    quality_score: Decimal


@dataclass
class PairFrequencyRow:
    number_a: int
    number_b: int
    cooccurrence_count: int
    support_pct: Decimal
    lift_score: Optional[Decimal]
    quality_score: Decimal


class StatisticsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_game_rule(self, *, game_code: str, game_variant: str, rule_version: str) -> Optional[GameRule]:
        stmt = (
            select(GameRule)
            .where(GameRule.game_code == game_code)
            .where(GameRule.game_variant == game_variant)
            .where(GameRule.rule_version == rule_version)
            .where(GameRule.is_active.is_(True))
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    def fetch_current_draws(
        self,
        *,
        game_rule_id: int,
        date_from: Optional[date],
        date_to: Optional[date],
    ) -> Sequence[LotteryDraw]:
        stmt: Select[tuple[LotteryDraw]] = (
            select(LotteryDraw)
            .options(
                selectinload(LotteryDraw.numbers),
                selectinload(LotteryDraw.strong_numbers),
            )
            .where(LotteryDraw.game_rule_id == game_rule_id)
            .where(LotteryDraw.is_current.is_(True))
        )
        if date_from:
            stmt = stmt.where(LotteryDraw.draw_date >= date_from)
        if date_to:
            stmt = stmt.where(LotteryDraw.draw_date <= date_to)
        stmt = stmt.order_by(LotteryDraw.draw_date.asc(), LotteryDraw.draw_number.asc())
        return self.db.execute(stmt).scalars().all()

    def find_snapshot_by_content(
        self,
        *,
        game_rule_id: int,
        window_start_date: date,
        window_end_date: date,
        algorithm_version: str,
        dataset_hash_sha256: str,
    ) -> Optional[AnalyticsSnapshot]:
        stmt = (
            select(AnalyticsSnapshot)
            .where(AnalyticsSnapshot.game_rule_id == game_rule_id)
            .where(AnalyticsSnapshot.window_start_date == window_start_date)
            .where(AnalyticsSnapshot.window_end_date == window_end_date)
            .where(AnalyticsSnapshot.algorithm_version == algorithm_version)
            .where(AnalyticsSnapshot.dataset_hash_sha256 == dataset_hash_sha256)
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    def supersede_published_snapshots(
        self,
        *,
        game_rule_id: int,
        window_start_date: date,
        window_end_date: date,
        algorithm_version: str,
    ) -> None:
        self.db.execute(
            update(AnalyticsSnapshot)
            .where(AnalyticsSnapshot.game_rule_id == game_rule_id)
            .where(AnalyticsSnapshot.window_start_date == window_start_date)
            .where(AnalyticsSnapshot.window_end_date == window_end_date)
            .where(AnalyticsSnapshot.algorithm_version == algorithm_version)
            .where(AnalyticsSnapshot.status == "published")
            .values(status="superseded")
        )

    def create_snapshot(
        self,
        *,
        snapshot_code: str,
        game_rule_id: int,
        snapshot_type: str,
        window_start_date: date,
        window_end_date: date,
        algorithm_version: str,
        engine_build_id: str,
        execution_manifest_jsonb: dict,
        dataset_hash_sha256: str,
        source_watermark_utc: datetime,
        quality_score: Decimal,
        status: str,
        created_by: str,
    ) -> AnalyticsSnapshot:
        snapshot = AnalyticsSnapshot(
            snapshot_code=snapshot_code,
            game_rule_id=game_rule_id,
            snapshot_type=snapshot_type,
            window_start_date=window_start_date,
            window_end_date=window_end_date,
            algorithm_version=algorithm_version,
            engine_build_id=engine_build_id,
            execution_manifest_jsonb=execution_manifest_jsonb,
            dataset_hash_sha256=dataset_hash_sha256,
            source_watermark_utc=source_watermark_utc,
            quality_score=quality_score,
            status=status,
            created_by=created_by,
            published_at_utc=datetime.now(timezone.utc) if status == "published" else None,
        )
        self.db.add(snapshot)
        self.db.flush()
        return snapshot

    def insert_number_frequency_rows(self, *, snapshot_id: int, rows: Sequence[NumberFrequencyRow]) -> None:
        for row in rows:
            self.db.add(
                NumberFrequency(
                    snapshot_id=snapshot_id,
                    number_value=row.number_value,
                    draw_count=row.draw_count,
                    appearance_count=row.appearance_count,
                    frequency_pct=row.frequency_pct,
                    recency_days=row.recency_days,
                    z_score=row.z_score,
                    quality_score=row.quality_score,
                )
            )

    def insert_pair_frequency_rows(self, *, snapshot_id: int, rows: Sequence[PairFrequencyRow]) -> None:
        for row in rows:
            self.db.add(
                PairFrequency(
                    snapshot_id=snapshot_id,
                    number_a=row.number_a,
                    number_b=row.number_b,
                    cooccurrence_count=row.cooccurrence_count,
                    support_pct=row.support_pct,
                    lift_score=row.lift_score,
                    quality_score=row.quality_score,
                )
            )

    def link_snapshot_import_ids(self, *, snapshot_id: int, import_ids: Sequence[int]) -> None:
        for import_id in sorted(set(import_ids)):
            self.db.add(SnapshotImportLineage(snapshot_id=snapshot_id, import_id=import_id))

    def log_system_audit(
        self,
        *,
        actor_id: str,
        action: str,
        entity_type: str,
        entity_id: str,
        result: str,
        severity: str,
        after_state: Optional[dict] = None,
    ) -> None:
        self.db.add(
            SystemAuditLog(
                actor_type="service",
                actor_id=actor_id,
                actor_role="statistics_engine",
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                result=result,
                severity=severity,
                after_state=after_state,
                retention_until_date=date.today() + timedelta(days=3650),
            )
        )

    def fetch_number_frequency_rows(self, *, snapshot_id: int) -> Sequence[NumberFrequency]:
        stmt = (
            select(NumberFrequency)
            .where(NumberFrequency.snapshot_id == snapshot_id)
            .order_by(NumberFrequency.number_value.asc())
        )
        return self.db.execute(stmt).scalars().all()

    def fetch_pair_frequency_rows(self, *, snapshot_id: int) -> Sequence[PairFrequency]:
        stmt = (
            select(PairFrequency)
            .where(PairFrequency.snapshot_id == snapshot_id)
            .order_by(PairFrequency.number_a.asc(), PairFrequency.number_b.asc())
        )
        return self.db.execute(stmt).scalars().all()

    def fetch_latest_published_snapshot(
        self,
        *,
        game_code: Optional[str] = None,
        game_variant: Optional[str] = None,
        rule_version: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> Optional[AnalyticsSnapshot]:
        stmt = (
            select(AnalyticsSnapshot)
            .join(GameRule, AnalyticsSnapshot.game_rule_id == GameRule.game_rule_id)
            .options(
                selectinload(AnalyticsSnapshot.number_frequency_rows),
                selectinload(AnalyticsSnapshot.import_lineage),
            )
            .where(AnalyticsSnapshot.status == "published")
            .where(AnalyticsSnapshot.snapshot_type == "frequency")
        )
        if game_code:
            stmt = stmt.where(GameRule.game_code == game_code)
        if game_variant:
            stmt = stmt.where(GameRule.game_variant == game_variant)
        if rule_version:
            stmt = stmt.where(GameRule.rule_version == rule_version)
        if date_from:
            stmt = stmt.where(AnalyticsSnapshot.window_start_date >= date_from)
        if date_to:
            stmt = stmt.where(AnalyticsSnapshot.window_end_date <= date_to)

        stmt = stmt.order_by(
            AnalyticsSnapshot.published_at_utc.desc(),
            AnalyticsSnapshot.created_at_utc.desc(),
            AnalyticsSnapshot.snapshot_id.desc(),
        ).limit(1)
        return self.db.execute(stmt).scalars().first()

    def resolve_game_rule_by_id(self, *, game_rule_id: int) -> Optional[GameRule]:
        stmt = select(GameRule).where(GameRule.game_rule_id == game_rule_id).limit(1)
        return self.db.execute(stmt).scalars().first()

