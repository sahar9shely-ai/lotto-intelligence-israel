from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=1)


class RequestPasswordResetRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    note: Optional[str] = Field(default=None, max_length=255)


class SetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class FulfillPasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    phone: Optional[str] = None
    access_password: Optional[str] = None
    role: str
    investor_id: int
    investor_name: str
    is_manager: bool
    is_active: bool = True
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


class PasswordResetRequestOut(BaseModel):
    id: int
    user_id: int
    username: str
    display_name: str
    status: str
    note: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolved_by_user_id: Optional[int] = None

    model_config = {"from_attributes": True}


class UpdateUserRequest(BaseModel):
    username: Optional[str] = Field(default=None, min_length=2, max_length=64)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    role: Optional[str] = Field(default=None, pattern="^(manager|investor)$")
    is_active: Optional[bool] = None
    investor_name: Optional[str] = Field(default=None, min_length=1, max_length=120)


class CreateAccessUserRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    email: Optional[EmailStr] = None
    role: str = Field(default="investor", pattern="^(manager|investor)$")
    phone: Optional[str] = None
    notes: Optional[str] = None


class EmailOutboxOut(BaseModel):
    id: int
    to_email: str
    subject: str
    body: str
    kind: str
    created_at: datetime
    meta_json: Optional[str] = None

    model_config = {"from_attributes": True}
