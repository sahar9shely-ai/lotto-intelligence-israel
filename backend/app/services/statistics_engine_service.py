from __future__ import annotations

import hashlib
import itertools
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.phase1 import LotteryDraw
from app.repositories.statistics_repository import (
    NumberFrequencyRow,
    PairFrequencyRow,
    StatisticsRepository,
)


@dataclass
class StatisticsSnapshotResult:
    snapshot_id: int
    snapshot_code: str
    status: str
    dataset_hash_sha256: str
    draw_count: int
    number_frequency_rows: int
    pair_frequency_rows: int
    reused_existing: bool


class StatisticsEngineService:
    SNAPSHOT_TYPE = "frequency"
    ALGORITHM_VERSION = "phase1_v1"
    ENGINE_BUILD_ID = "statistics-engine-phase1"

    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = StatisticsRepository(db)

    def generate_snapshot(
        self,
        *,
        game_code: str,
        game_variant: str,
        rule_version: str,
        created_by: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        force_regenerate: bool = False,
        dry_run: bool = False,
    ) -> StatisticsSnapshotResult:
        try:
            with self.db.begin():
                rule = self.repo.resolve_game_rule(
                    game_code=game_code,
                    game_variant=game_variant,
                    rule_version=rule_version,
                )
                if rule is None:
                    raise ValueError("Game rule not found for statistics generation.")

                draws = self.repo.fetch_current_draws(
                    game_rule_id=rule.game_rule_id,
                    date_from=date_from,
                    date_to=date_to,
                )
                if not draws:
                    raise ValueError("No current draws found for requested statistics window.")

                window_start = date_from or min(d.draw_date for d in draws)
                window_end = date_to or max(d.draw_date for d in draws)
                if window_start > window_end:
                    raise ValueError("Invalid date range: date_from must be less than or equal to date_to.")

                dataset_hash = self._compute_dataset_hash(draws)
                existing = self.repo.find_snapshot_by_content(
                    game_rule_id=rule.game_rule_id,
                    window_start_date=window_start,
                    window_end_date=window_end,
                    algorithm_version=self.ALGORITHM_VERSION,
                    dataset_hash_sha256=dataset_hash,
                )
                if dry_run:
                    number_rows = self._compute_number_frequency_rows(draws)
                    pair_rows = self._compute_pair_frequency_rows(draws)
                    self.repo.log_system_audit(
                        actor_id=created_by,
                        action="statistics_snapshot_dry_run",
                        entity_type="analytics_snapshots",
                        entity_id="n/a",
                        result="success",
                        severity="info",
                        after_state={
                            "dataset_hash_sha256": dataset_hash,
                            "draw_count": len(draws),
                            "number_frequency_rows": len(number_rows),
                            "pair_frequency_rows": len(pair_rows),
                            "window_start": str(window_start),
                            "window_end": str(window_end),
                            "would_reuse_existing": existing is not None,
                        },
                    )
                    return StatisticsSnapshotResult(
                        snapshot_id=0,
                        snapshot_code="dry_run",
                        status="dry_run",
                        dataset_hash_sha256=dataset_hash,
                        draw_count=len(draws),
                        number_frequency_rows=len(number_rows),
                        pair_frequency_rows=len(pair_rows),
                        reused_existing=False,
                    )
                if existing:
                    self.repo.log_system_audit(
                        actor_id=created_by,
                        action="statistics_snapshot_reused"
                        if not force_regenerate
                        else "statistics_snapshot_force_reuse",
                        entity_type="analytics_snapshots",
                        entity_id=str(existing.snapshot_id),
                        result="success",
                        severity="info",
                        after_state={
                            "dataset_hash_sha256": dataset_hash,
                            "draw_count": len(draws),
                            "force_regenerate": force_regenerate,
                            "dry_run": dry_run,
                        },
                    )
                    return StatisticsSnapshotResult(
                        snapshot_id=existing.snapshot_id,
                        snapshot_code=existing.snapshot_code,
                        status=existing.status,
                        dataset_hash_sha256=existing.dataset_hash_sha256,
                        draw_count=len(draws),
                        number_frequency_rows=len(existing.number_frequency_rows),
                        pair_frequency_rows=len(existing.pair_frequency_rows),
                        reused_existing=True,
                    )

                number_rows = self._compute_number_frequency_rows(draws)
                strong_counts = self._compute_strong_frequency_counts(draws)
                pair_rows = self._compute_pair_frequency_rows(draws)
                source_watermark = max(d.ingested_at_utc for d in draws)
                snapshot_code = (
                    f"snp_{rule.game_code}_{rule.game_variant}_{window_start}_{window_end}_{uuid4().hex[:8]}"
                )

                self.repo.supersede_published_snapshots(
                    game_rule_id=rule.game_rule_id,
                    window_start_date=window_start,
                    window_end_date=window_end,
                    algorithm_version=self.ALGORITHM_VERSION,
                )

                manifest = {
                    "algorithm": self.ALGORITHM_VERSION,
                    "mode": "full_recalculation",
                    "force_regenerate": force_regenerate,
                    "draw_count": len(draws),
                    "window_start": str(window_start),
                    "window_end": str(window_end),
                    "strong_frequency_counts": {str(k): v for k, v in sorted(strong_counts.items())},
                }
                snapshot = self.repo.create_snapshot(
                    snapshot_code=snapshot_code,
                    game_rule_id=rule.game_rule_id,
                    snapshot_type=self.SNAPSHOT_TYPE,
                    window_start_date=window_start,
                    window_end_date=window_end,
                    algorithm_version=self.ALGORITHM_VERSION,
                    engine_build_id=self.ENGINE_BUILD_ID,
                    execution_manifest_jsonb=manifest,
                    dataset_hash_sha256=dataset_hash,
                    source_watermark_utc=source_watermark,
                    quality_score=Decimal("100.00"),
                    status="published",
                    created_by=created_by,
                )
                self.repo.insert_number_frequency_rows(snapshot_id=snapshot.snapshot_id, rows=number_rows)
                self.repo.insert_pair_frequency_rows(snapshot_id=snapshot.snapshot_id, rows=pair_rows)
                self.repo.link_snapshot_import_ids(
                    snapshot_id=snapshot.snapshot_id,
                    import_ids=[d.import_id for d in draws],
                )
                self.repo.log_system_audit(
                    actor_id=created_by,
                    action="statistics_snapshot_generated",
                    entity_type="analytics_snapshots",
                    entity_id=str(snapshot.snapshot_id),
                    result="success",
                    severity="info",
                    after_state={
                        "dataset_hash_sha256": dataset_hash,
                        "draw_count": len(draws),
                        "number_frequency_rows": len(number_rows),
                        "pair_frequency_rows": len(pair_rows),
                        "status": "published",
                        "dry_run": dry_run,
                    },
                )

                return StatisticsSnapshotResult(
                    snapshot_id=snapshot.snapshot_id,
                    snapshot_code=snapshot.snapshot_code,
                    status=snapshot.status,
                    dataset_hash_sha256=dataset_hash,
                    draw_count=len(draws),
                    number_frequency_rows=len(number_rows),
                    pair_frequency_rows=len(pair_rows),
                    reused_existing=False,
                )
        except Exception as exc:
            with self.db.begin():
                self.repo.log_system_audit(
                    actor_id=created_by,
                    action="statistics_snapshot_failed",
                    entity_type="analytics_snapshots",
                    entity_id="n/a",
                    result="failure",
                    severity="warn",
                    after_state={
                        "game_code": game_code,
                        "game_variant": game_variant,
                        "rule_version": rule_version,
                        "error": str(exc),
                    },
                )
            raise

    @staticmethod
    def _compute_dataset_hash(draws: list[LotteryDraw]) -> str:
        normalized = []
        for draw in draws:
            normalized.append(
                {
                    "draw_number": draw.draw_number,
                    "draw_date": str(draw.draw_date),
                    "regular_numbers": [n.number_value for n in sorted(draw.numbers, key=lambda x: x.position_no)],
                    "strong_numbers": [n.strong_value for n in sorted(draw.strong_numbers, key=lambda x: x.position_no)],
                }
            )
        payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _quantize_pct(value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

    @staticmethod
    def _compute_number_frequency_rows(draws: list[LotteryDraw]) -> list[NumberFrequencyRow]:
        total_draws = len(draws)
        now_date = datetime.now(timezone.utc).date()

        # number_frequency table stores regular-number stats only.
        presence_counts: dict[int, int] = {}
        last_seen: dict[int, date] = {}

        for draw in draws:
            draw_values = {number.number_value for number in draw.numbers}
            for value in draw_values:
                presence_counts[value] = presence_counts.get(value, 0) + 1
                last_seen[value] = max(draw.draw_date, last_seen.get(value, draw.draw_date))

        rows: list[NumberFrequencyRow] = []
        for value in sorted(presence_counts.keys()):
            appearance_count = presence_counts[value]
            rows.append(
                NumberFrequencyRow(
                    number_value=value,
                    draw_count=total_draws,
                    appearance_count=appearance_count,
                    frequency_pct=StatisticsEngineService._quantize_pct(
                        (Decimal(appearance_count) / Decimal(total_draws)) * Decimal("100")
                    ),
                    recency_days=(now_date - last_seen[value]).days,
                    z_score=None,
                    quality_score=Decimal("100.00"),
                )
            )
        return rows

    @staticmethod
    def _compute_strong_frequency_counts(draws: list[LotteryDraw]) -> dict[int, int]:
        strong_counts: dict[int, int] = {}
        for draw in draws:
            for strong in draw.strong_numbers:
                strong_counts[strong.strong_value] = strong_counts.get(strong.strong_value, 0) + 1
        return strong_counts

    @staticmethod
    def _compute_pair_frequency_rows(draws: list[LotteryDraw]) -> list[PairFrequencyRow]:
        total_draws = len(draws)
        pair_counts: dict[tuple[int, int], int] = {}
        for draw in draws:
            values = sorted([n.number_value for n in draw.numbers])
            for a, b in itertools.combinations(values, 2):
                pair_counts[(a, b)] = pair_counts.get((a, b), 0) + 1

        rows: list[PairFrequencyRow] = []
        for (a, b), count in sorted(pair_counts.items(), key=lambda x: (x[0][0], x[0][1])):
            rows.append(
                PairFrequencyRow(
                    number_a=a,
                    number_b=b,
                    cooccurrence_count=count,
                    support_pct=StatisticsEngineService._quantize_pct(
                        (Decimal(count) / Decimal(total_draws)) * Decimal("100")
                    ),
                    lift_score=None,
                    quality_score=Decimal("100.00"),
                )
            )
        return rows

