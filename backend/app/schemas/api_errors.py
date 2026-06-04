from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ApiError(BaseModel):
    code: str
    message: str
    details: Optional[Any] = None


class ApiErrorResponse(BaseModel):
    error: ApiError

