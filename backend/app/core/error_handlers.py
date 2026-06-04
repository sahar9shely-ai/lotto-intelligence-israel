from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import AppError


def _error_body(*, code: str, message: str, details: Any = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details if details is not None else {}}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(code=exc.code, message=exc.message, details=exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_body(
                code="REQUEST_VALIDATION_ERROR",
                message="Request validation failed.",
                details=exc.errors(),
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content=_error_body(
                code="INTERNAL_SERVER_ERROR",
                message="Unexpected server error.",
                details=str(exc),
            ),
        )

