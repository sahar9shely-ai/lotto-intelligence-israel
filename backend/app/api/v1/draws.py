from __future__ import annotations

from datetime import date
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, InternalServerError, NotFoundError
from app.db.session import SessionLocal
from app.repositories.draw_repository import DrawRepository
from app.schemas.api_errors import ApiErrorResponse
from app.schemas.draws import DrawItemResponse, DrawListResponse

DrawSort = Literal["draw_date_desc", "draw_date_asc", "draw_number_desc", "draw_number_asc"]

router = APIRouter(prefix="/api/v1", tags=["draws"])


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get(
    "/draws/{draw_id}",
    response_model=DrawItemResponse,
    responses={
        404: {"model": ApiErrorResponse, "description": "Draw not found"},
        500: {"model": ApiErrorResponse, "description": "Internal server error"},
    },
)
def get_draw_by_id(
    draw_id: UUID = Path(..., description="Draw UID"),
    db: Session = Depends(get_db),
) -> DrawItemResponse:
    repo = DrawRepository(db)
    try:
        draw = repo.get_draw_by_uid(draw_uid=draw_id, include_history=False)
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Failed to fetch draw.",
            details=str(exc),
        )

    if draw is None:
        raise NotFoundError(
            code="DRAW_NOT_FOUND",
            message="Requested draw was not found.",
            details={"draw_id": str(draw_id)},
        )

    return DrawItemResponse(
        draw_uid=draw.draw_uid,
        draw_number=draw.draw_number,
        draw_date=draw.draw_date,
        draw_timestamp_utc=draw.draw_timestamp_utc,
        source_system=draw.source_system,
        source_record_id=draw.source_record_id,
        source_revision=draw.source_revision,
        jackpot_amount=draw.jackpot_amount,
        currency_code=draw.currency_code,
        game_code=draw.game_rule.game_code,
        game_variant=draw.game_rule.game_variant,
        rule_version=draw.game_rule.rule_version,
        regular_numbers=[n.number_value for n in sorted(draw.numbers, key=lambda x: x.position_no)],
        strong_numbers=[n.strong_value for n in sorted(draw.strong_numbers, key=lambda x: x.position_no)],
    )


@router.get(
    "/draws",
    response_model=DrawListResponse,
    responses={
        400: {"model": ApiErrorResponse, "description": "Invalid request"},
        500: {"model": ApiErrorResponse, "description": "Internal server error"},
    },
)
def list_draws(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    game_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    game_variant: Optional[str] = Query(default=None, min_length=1, max_length=32),
    rule_version: Optional[str] = Query(default=None, min_length=1, max_length=32),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort: DrawSort = Query(default="draw_date_desc"),
    db: Session = Depends(get_db),
) -> DrawListResponse:
    if date_from and date_to and date_from > date_to:
        raise BadRequestError(
            code="INVALID_DATE_RANGE",
            message="date_from must be less than or equal to date_to.",
            details={"date_from": str(date_from), "date_to": str(date_to)},
        )

    repo = DrawRepository(db)
    try:
        total_count, draws = repo.list_draws(
            game_code=game_code,
            game_variant=game_variant,
            rule_version=rule_version,
            from_date=date_from,
            to_date=date_to,
            is_current=True,
            page=page,
            page_size=page_size,
            sort=sort,
        )

        items = [
            DrawItemResponse(
                draw_uid=draw.draw_uid,
                draw_number=draw.draw_number,
                draw_date=draw.draw_date,
                draw_timestamp_utc=draw.draw_timestamp_utc,
                source_system=draw.source_system,
                source_record_id=draw.source_record_id,
                source_revision=draw.source_revision,
                jackpot_amount=draw.jackpot_amount,
                currency_code=draw.currency_code,
                game_code=draw.game_rule.game_code,
                game_variant=draw.game_rule.game_variant,
                rule_version=draw.game_rule.rule_version,
                regular_numbers=[n.number_value for n in sorted(draw.numbers, key=lambda x: x.position_no)],
                strong_numbers=[n.strong_value for n in sorted(draw.strong_numbers, key=lambda x: x.position_no)],
            )
            for draw in draws
        ]

        return DrawListResponse(total_count=total_count, page=page, page_size=page_size, items=items)
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Failed to fetch draws.",
            details=str(exc),
        )

