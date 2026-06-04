from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, InternalServerError
from app.db.session import SessionLocal
from app.schemas.api_errors import ApiErrorResponse
from app.schemas.stats import SnapshotGenerateRequest, SnapshotGenerateResponse
from app.services.statistics_engine_service import StatisticsEngineService

router = APIRouter(prefix="/api/v1/admin/stats", tags=["admin-stats"])


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post(
    "/snapshots/generate",
    response_model=SnapshotGenerateResponse,
    responses={
        400: {"model": ApiErrorResponse, "description": "Invalid snapshot operation request"},
        500: {"model": ApiErrorResponse, "description": "Internal server error"},
    },
)
def generate_or_reuse_snapshot(
    payload: SnapshotGenerateRequest,
    db: Session = Depends(get_db),
) -> SnapshotGenerateResponse:
    if payload.date_from and payload.date_to and payload.date_from > payload.date_to:
        raise BadRequestError(
            code="INVALID_DATE_RANGE",
            message="date_from must be less than or equal to date_to.",
            details={"date_from": str(payload.date_from), "date_to": str(payload.date_to)},
        )
    service = StatisticsEngineService(db)
    try:
        result = service.generate_snapshot(
            game_code=payload.game_code,
            game_variant=payload.game_variant,
            rule_version=payload.rule_version,
            created_by=payload.triggered_by,
            date_from=payload.date_from,
            date_to=payload.date_to,
            dry_run=payload.dry_run,
        )
    except ValueError as exc:
        raise BadRequestError(
            code="SNAPSHOT_OPERATION_INVALID",
            message="Snapshot operation request is invalid.",
            details=str(exc),
        )
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Snapshot operation failed due to database error.",
            details=str(exc),
        )
    return SnapshotGenerateResponse(
        snapshot_id=result.snapshot_id,
        reused_existing=result.reused_existing,
        draw_count=result.draw_count,
        dataset_hash_sha256=result.dataset_hash_sha256,
        status=result.status,
    )

