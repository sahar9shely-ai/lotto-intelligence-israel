from __future__ import annotations

from typing import Any, Optional


class AppError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int,
        details: Optional[Any] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


class BadRequestError(AppError):
    def __init__(self, *, code: str, message: str, details: Optional[Any] = None) -> None:
        super().__init__(code=code, message=message, status_code=400, details=details)


class NotFoundError(AppError):
    def __init__(self, *, code: str, message: str, details: Optional[Any] = None) -> None:
        super().__init__(code=code, message=message, status_code=404, details=details)


class ConflictError(AppError):
    def __init__(self, *, code: str, message: str, details: Optional[Any] = None) -> None:
        super().__init__(code=code, message=message, status_code=409, details=details)


class InternalServerError(AppError):
    def __init__(self, *, code: str, message: str, details: Optional[Any] = None) -> None:
        super().__init__(code=code, message=message, status_code=500, details=details)

