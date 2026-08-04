from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    investor_id: int
    investor_name: str
    is_manager: bool
    must_reset_password: bool
    has_password: bool
    last_login_at: Optional[datetime] = None
    password_set_at: Optional[datetime] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MessageOut(BaseModel):
    message: str


class LoginAlertOut(BaseModel):
    id: int
    user_id: int
    investor_id: int
    email: str
    display_name: str
    logged_in_at: datetime
    read_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UpdateUserEmailRequest(BaseModel):
    email: EmailStr


class EmailOutboxOut(BaseModel):
    id: int
    to_email: str
    subject: str
    body: str
    kind: str
    created_at: datetime
    meta_json: Optional[str] = None

    model_config = {"from_attributes": True}
