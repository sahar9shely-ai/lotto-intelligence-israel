from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.security.auth import get_current_user, is_manager, require_manager
from app.services import assistant_service as asst
from app.services import investment_service as inv_svc

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessageIn] = Field(default_factory=list, max_length=40)


class ChatResponse(BaseModel):
    reply: str
    pdf_suggested: bool = False
    what_if: Optional[dict] = None
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
    key = (getattr(settings, "assistant_api_key", None) or "").strip()
    hint = None
    if key and is_manager(user):
        hint = f"…{key[-4:]}" if len(key) >= 4 else "****"
    return {
        "configured": bool(key),
        "provider": (getattr(settings, "assistant_provider", None) or "gemini"),
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
    summary = asst.summarize_conversation(db, investor_name=name, messages=history)

    # Investors' chats always notify manager. Manager's own chat is stored lightly.
    if is_manager(user):
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
        "detail": result.get("detail") or "",
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
