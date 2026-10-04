from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.security.auth import get_current_user, is_system_admin
from app.services import assistant_service as asst
from app.services import assistant_actions as actions
from app.services import investment_service as inv_svc

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessageIn] = Field(default_factory=list, max_length=40)


class AssistantActionOut(BaseModel):
    token: str
    kind: Literal["payment_confirmation_request"]
    investor_name: str
    payment_id: int
    amount: float
    due_date: date
    month_label: str


class ChatResponse(BaseModel):
    reply: str
    pdf_suggested: bool = False
    what_if: Optional[dict] = None
    configured: bool = False
    cta: Optional[dict] = None
    suggestions: list[dict] = Field(default_factory=list)
    action: Optional[AssistantActionOut] = None


class ConfirmActionRequest(BaseModel):
    token: str = Field(min_length=1, max_length=4000)


class ConfirmActionResponse(BaseModel):
    reply: str
    action: None = None
    payment_id: Optional[int] = None


class AssistantOpeningOut(BaseModel):
    greeting: str
    suggestions: list[dict] = Field(default_factory=list)
    cta: Optional[dict] = None
    role: str = "investor"
    tips: list[str] = Field(default_factory=list)
    configured: bool = False


class EndSessionRequest(BaseModel):
    history: list[ChatMessageIn] = Field(default_factory=list, max_length=60)


class EndSessionResponse(BaseModel):
    summary: str
    notified: bool
    detail: str


class AssistantStatusOut(BaseModel):
    configured: bool
    provider: str
    api_key_set: bool
    api_key_hint: Optional[str] = None


class WhatIfRequest(BaseModel):
    extra_principal: float = Field(ge=0, le=50_000_000)


@router.get("/status", response_model=AssistantStatusOut)
def assistant_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    settings = inv_svc.ensure_settings(db)
    provider, key = asst._llm_credentials(settings)
    hint = None
    if key and is_system_admin(user):
        hint = f"…{key[-4:]}" if len(key) >= 4 else "****"
    return {
        "configured": bool(key),
        "provider": provider or "gemini",
        "api_key_set": bool(key),
        "api_key_hint": hint,
    }


@router.post("/chat", response_model=ChatResponse)
def assistant_chat(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if not user.investor_id:
        raise HTTPException(status_code=403, detail="אין תיק מקושר")
    try:
        result = asst.chat(
            db,
            user=user,
            message=body.message,
            history=[m.model_dump() for m in body.history],
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.post("/actions/confirm", response_model=ConfirmActionResponse)
def confirm_assistant_action(
    body: ConfirmActionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if not is_system_admin(user):
        raise HTTPException(status_code=403, detail="הפעולה זמינה למנהל המערכת בלבד")
    try:
        result = actions.execute_payment_confirmation(db, user=user, token=body.token)
    except PermissionError as exc:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"reply": result["reply"], "action": None, "payment_id": result.get("payment_id")}


@router.get("/opening", response_model=AssistantOpeningOut)
def assistant_opening(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if not user.investor_id:
        raise HTTPException(status_code=403, detail="אין תיק מקושר")
    try:
        return asst.opening_state(db, user=user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/what-if")
def assistant_what_if(
    body: WhatIfRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if not user.investor_id:
        raise HTTPException(status_code=403, detail="אין תיק מקושר")
    context = asst.build_investor_context(db, investor_id=user.investor_id)
    return asst.what_if_add_principal(context, body.extra_principal)


@router.post("/end-session", response_model=EndSessionResponse)
def end_session(
    body: EndSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    """Close chat and notify the manager with a conversation summary."""
    if not user.investor_id:
        raise HTTPException(status_code=403, detail="אין תיק מקושר")
    investor = user.investor
    name = investor.name if investor else user.username
    history = [m.model_dump() for m in body.history]
    if not is_system_admin(user):
        # Browser-supplied assistant replies are not a verified server transcript.
        history = [m for m in history if m["role"] == "user"]
    summary = asst.summarize_conversation(db, investor_name=name, messages=history)

    # Investors' chats always notify manager. Manager's own chat is stored lightly.
    if is_system_admin(user):
        return {
            "summary": summary,
            "notified": False,
            "detail": "שיחת מנהל — לא נשלח סיכום נוסף",
        }

    result = asst.notify_manager_of_summary(
        db, summary=summary, investor_name=name
    )
    return {
        "summary": summary,
        "notified": bool(result.get("sent_slack")),
        "detail": "השיחה הסתיימה",
    }


@router.get("/portfolio-brief")
def portfolio_brief(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    """Sanitized portfolio snapshot for PDF — own data only, no fees."""
    if not user.investor_id:
        raise HTTPException(status_code=403, detail="אין תיק מקושר")
    return asst.build_investor_context(db, investor_id=user.investor_id)
