from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import AppError


def _error_body(*, code: str, message: str, details: Any = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details if details is not None else {}}}


def _jsonable_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for err in errors:
        item = dict(err)
        ctx = item.get("ctx")
        if isinstance(ctx, dict) and "error" in ctx:
            ctx = dict(ctx)
            ctx["error"] = str(ctx["error"])
            item["ctx"] = ctx
        cleaned.append(item)
    return cleaned


def _hebrew_validation_message(errors: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for err in errors:
        loc = err.get("loc") or ()
        field = loc[-1] if loc else ""
        msg = str(err.get("msg") or "")
        msg = msg.replace("Value error, ", "")
        if field == "username":
            parts.append(
                "שם משתמש חייב להכיל אותיות באנגלית / ספרות / . _ - (2–64 תווים), בלי רווחים"
            )
        elif field == "email":
            parts.append("כתובת המייל לא תקינה")
        elif field == "new_password":
            parts.append("הסיסמה חייבת להכיל לפחות 8 תווים")
        elif msg:
            parts.append(msg)
    return " · ".join(parts) or "הנתונים לא תקינים"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(code=exc.code, message=exc.message, details=exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = _jsonable_errors(exc.errors())
        message = _hebrew_validation_message(errors)
        return JSONResponse(
            status_code=422,
            content={
                "detail": message,
                "error": {
                    "code": "REQUEST_VALIDATION_ERROR",
                    "message": message,
                    "details": errors,
                },
            },
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

