"""Authenticated opt-in browser notification preferences."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.models.push import PushSubscription
from app.security.auth import get_current_user
from app.services import push_service as push

router = APIRouter(prefix="/api/v1/push", tags=["push"])


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p256dh: str = Field(min_length=1, max_length=100)
    auth: str = Field(min_length=1, max_length=32)


class SubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushKeys


class UnsubscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(min_length=1, max_length=2048)


@router.get("/config")
def config(_: User = Depends(get_current_user)):
    return push.public_config()


@router.get("/subscriptions/status")
def status(endpoint: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    try:
        return push.subscription_status(db, user, endpoint)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/subscriptions")
def subscribe(payload: SubscriptionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    if not push.is_enabled():
        raise HTTPException(status_code=503, detail="התראות לטלפון אינן זמינות כרגע")
    try:
        device = push.subscribe(db, user, endpoint=payload.endpoint, p256dh=payload.keys.p256dh, auth=payload.keys.auth)
        push.enqueue_outstanding_for_device(db, device)
        db.commit()
    except push.SubscriptionConflict as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except push.SubscriptionLimit as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"subscribed": True}


@router.post("/subscriptions/status")
def device_status(payload: UnsubscribeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    # The body form keeps the private endpoint capability out of access-log URLs.
    try:
        return push.subscription_status(db, user, payload.endpoint)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/subscriptions")
def unsubscribe(payload: UnsubscribeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    try:
        push.unsubscribe(db, user, payload.endpoint)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"subscribed": False}


@router.delete("/subscriptions/all")
def unsubscribe_all(user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    db.query(PushSubscription).filter_by(user_id=user.id).delete(synchronize_session=False)
    db.commit()
    return {"subscribed": False}
