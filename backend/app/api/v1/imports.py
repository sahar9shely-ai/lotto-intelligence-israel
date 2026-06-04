from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, ConflictError, InternalServerError
from app.db.session import SessionLocal
from app.schemas.api_errors import ApiErrorResponse
from app.schemas.import_pipeline import ImportBatchRequest, ImportBatchResult
from app.services.historical_import_service import HistoricalDataImportService

router = APIRouter(prefix="/api/v1/import", tags=["imports"])


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post(
    "/draws",
    response_model=ImportBatchResult,
    responses={
        400: {"model": ApiErrorResponse, "description": "Invalid import request"},
        409: {"model": ApiErrorResponse, "description": "Import conflict"},
        500: {"model": ApiErrorResponse, "description": "Internal server error"},
    },
)
def import_historical_draws(
    payload: ImportBatchRequest,
    db: Session = Depends(get_db),
) -> ImportBatchResult:
    service = HistoricalDataImportService(db)
    try:
        return service.run_batch_import(payload)
    except ValueError as exc:
        raise BadRequestError(
            code="IMPORT_VALIDATION_ERROR",
            message="Import request failed validation.",
            details=str(exc),
        )
    except IntegrityError as exc:
        raise ConflictError(
            code="IMPORT_CONFLICT",
            message="Import could not be applied due to data conflict.",
            details=str(exc.orig) if exc.orig else str(exc),
        )
    except SQLAlchemyError as exc:
        raise InternalServerError(
            code="DATABASE_ERROR",
            message="Import failed due to database error.",
            details=str(exc),
        )

