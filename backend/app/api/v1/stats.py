from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import InternalServerError, NotFoundError
from app.db.session import SessionLocal
from app.repositories.statistics_repository import StatisticsRepository
from app.schemas.api_errors import ApiErrorResponse
from app.schemas.stats import (
    FrequencyItem,
    FrequencyResponse,
    PairItem,
    PairResponse,
    StatsSnapshotRef,
    StatsSummaryResponse,
    StrongNumberItem,
    StrongNumberResponse,
)

router = APIRouter(prefix="/api/v1/stats", tags=["stats"])


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _quantize_pct(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _resolve_snapshot(
    repo: StatisticsRepository,
    *,
    game_code: Optional[str],
    game_variant: Optional[str],
    rule_version: Optional[str],
    date_from: Optional[date],
    date_to: Optional[date],
):
    return repo.fetch_latest_published_snapshot(
        game_code=game_code,
        game_variant=game_variant,
        rule_version=rule_version,
        date_from=date_from,
        date_to=date_to,
    )


def _raise_snapshot_not_found() -> None:
    raise NotFoundError(
        code="SNAPSHOT_NOT_FOUND",
        message="No published statistics snapshot matched the requested filters.",
        details={},
    )


def _build_snapshot_ref(snapshot, game_rule) -> StatsSnapshotRef:
    return StatsSnapshotRef(
        snapshot_id=snapshot.snapshot_id,
        snapshot_code=snapshot.snapshot_code,
        game_code=game_rule.game_code,
        game_variant=game_rule.game_variant,
        rule_version=game_rule.rule_version,
        window_start_date=snapshot.window_start_date,
        window_end_date=snapshot.window_end_date,
        published_at_utc=snapshot.published_at_utc,
    )


@router.get(
    "/frequency",
    response_model=FrequencyResponse,
    responses={404: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
def get_frequency(
    game_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    game_variant: Optional[str] = Query(default=None, min_length=1, max_length=32),
    rule_version: Optional[str] = Query(default=None, min_length=1, max_length=32),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
) -> FrequencyResponse:
    repo = StatisticsRepository(db)
    try:
        snapshot = _resolve_snapshot(
            repo,
            game_code=game_code,
            game_variant=game_variant,
            rule_version=rule_version,
            date_from=date_from,
            date_to=date_to,
        )
        game_rule = repo.resolve_game_rule_by_id(game_rule_id=snapshot.game_rule_id) if snapshot else None
        rows = repo.fetch_number_frequency_rows(snapshot_id=snapshot.snapshot_id) if snapshot else []
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Failed to fetch frequency stats.",
            details=str(exc),
        )
    if snapshot is None or game_rule is None:
        _raise_snapshot_not_found()
    return FrequencyResponse(
        snapshot=_build_snapshot_ref(snapshot, game_rule),
        items=[
            FrequencyItem(
                number_value=row.number_value,
                appearance_count=row.appearance_count,
                draw_count=row.draw_count,
                frequency_pct=row.frequency_pct,
                recency_days=row.recency_days,
            )
            for row in rows
        ],
    )


@router.get(
    "/strong-number",
    response_model=StrongNumberResponse,
    responses={404: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
def get_strong_number_frequency(
    game_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    game_variant: Optional[str] = Query(default=None, min_length=1, max_length=32),
    rule_version: Optional[str] = Query(default=None, min_length=1, max_length=32),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
) -> StrongNumberResponse:
    repo = StatisticsRepository(db)
    try:
        snapshot = _resolve_snapshot(
            repo,
            game_code=game_code,
            game_variant=game_variant,
            rule_version=rule_version,
            date_from=date_from,
            date_to=date_to,
        )
        game_rule = repo.resolve_game_rule_by_id(game_rule_id=snapshot.game_rule_id) if snapshot else None
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Failed to fetch strong number stats.",
            details=str(exc),
        )
    if snapshot is None or game_rule is None:
        _raise_snapshot_not_found()

    manifest = snapshot.execution_manifest_jsonb or {}
    strong_counts_raw = manifest.get("strong_frequency_counts", {})
    draw_count = int(manifest.get("draw_count", 0))
    items: list[StrongNumberItem] = []
    for key, count in sorted(strong_counts_raw.items(), key=lambda kv: int(kv[0])):
        strong_value = int(key)
        appearance_count = int(count)
        pct = Decimal("0")
        if draw_count > 0:
            pct = _quantize_pct((Decimal(appearance_count) / Decimal(draw_count)) * Decimal("100"))
        items.append(
            StrongNumberItem(
                strong_value=strong_value,
                appearance_count=appearance_count,
                draw_count=draw_count,
                frequency_pct=pct,
            )
        )

    return StrongNumberResponse(snapshot=_build_snapshot_ref(snapshot, game_rule), items=items)


@router.get(
    "/pairs",
    response_model=PairResponse,
    responses={404: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
def get_pair_frequency(
    game_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    game_variant: Optional[str] = Query(default=None, min_length=1, max_length=32),
    rule_version: Optional[str] = Query(default=None, min_length=1, max_length=32),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
) -> PairResponse:
    repo = StatisticsRepository(db)
    try:
        snapshot = _resolve_snapshot(
            repo,
            game_code=game_code,
            game_variant=game_variant,
            rule_version=rule_version,
            date_from=date_from,
            date_to=date_to,
        )
        game_rule = repo.resolve_game_rule_by_id(game_rule_id=snapshot.game_rule_id) if snapshot else None
        rows = repo.fetch_pair_frequency_rows(snapshot_id=snapshot.snapshot_id) if snapshot else []
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Failed to fetch pair stats.",
            details=str(exc),
        )
    if snapshot is None or game_rule is None:
        _raise_snapshot_not_found()
    return PairResponse(
        snapshot=_build_snapshot_ref(snapshot, game_rule),
        items=[
            PairItem(
                number_a=row.number_a,
                number_b=row.number_b,
                cooccurrence_count=row.cooccurrence_count,
                support_pct=row.support_pct,
            )
            for row in rows
        ],
    )


@router.get(
    "/summary",
    response_model=StatsSummaryResponse,
    responses={404: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
def get_stats_summary(
    game_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    game_variant: Optional[str] = Query(default=None, min_length=1, max_length=32),
    rule_version: Optional[str] = Query(default=None, min_length=1, max_length=32),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
) -> StatsSummaryResponse:
    repo = StatisticsRepository(db)
    try:
        snapshot = _resolve_snapshot(
            repo,
            game_code=game_code,
            game_variant=game_variant,
            rule_version=rule_version,
            date_from=date_from,
            date_to=date_to,
        )
        game_rule = repo.resolve_game_rule_by_id(game_rule_id=snapshot.game_rule_id) if snapshot else None
        pair_rows = repo.fetch_pair_frequency_rows(snapshot_id=snapshot.snapshot_id) if snapshot else []
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Failed to fetch stats summary.",
            details=str(exc),
        )
    if snapshot is None or game_rule is None:
        _raise_snapshot_not_found()

    manifest = snapshot.execution_manifest_jsonb or {}
    strong_counts = manifest.get("strong_frequency_counts", {})
    draw_count = int(manifest.get("draw_count", 0))
    lineage_import_ids = sorted([line.import_id for line in snapshot.import_lineage])
    return StatsSummaryResponse(
        snapshot=_build_snapshot_ref(snapshot, game_rule),
        dataset_hash_sha256=snapshot.dataset_hash_sha256,
        algorithm_version=snapshot.algorithm_version,
        engine_build_id=snapshot.engine_build_id,
        draw_count=draw_count,
        regular_number_rows=len(snapshot.number_frequency_rows),
        strong_number_rows=len(strong_counts),
        pair_rows=len(pair_rows),
        lineage_import_ids=lineage_import_ids,
    )

