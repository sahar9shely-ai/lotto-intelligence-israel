from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db, investment_engine
from app.models import auth as auth_models  # noqa: F401
from app.models import investments as investment_models  # noqa: F401
from app.models.auth import User
from app.models.investments import Investor, InvestmentPlan, InvestmentTopupRequest, Payment, Quote
from app.schemas.investments import (
    DashboardOut,
    InvestorCreate,
    InvestorOut,
    InvestorUpdate,
    PaymentOut,
    PaymentReportOut,
    PaymentUpdate,
    PlanCreate,
    PlanOut,
    PlanSettleRequest,
    PlanSettleResult,
    PlanUpdate,
    QuoteConvert,
    QuoteCreate,
    QuoteOut,
    QuoteUpdate,
    SavingsActionRequest,
    SavingsActionResult,
    SettingsOut,
    SettingsUpdate,
    SiteStatusOut,
    SlackAnnounceOut,
    TopupRequestApprove,
    TopupRequestCreate,
    TopupRequestDecision,
    TopupRequestOut,
    TopupRequestSign,
)
from app.security.auth import get_current_user, is_manager, require_manager
from app.services import auth_service as auth_svc
from app.services import investment_service as svc

router = APIRouter(prefix="/api/v1/investments", tags=["investments"])

InvestmentBase.metadata.create_all(bind=investment_engine)


def init_investment_db() -> None:
    from app.db.investment_session import InvestmentSessionLocal
    from app.db.schema_migrate import ensure_schema

    ensure_schema(investment_engine)

    db = InvestmentSessionLocal()
    try:
        svc.seed_defaults(db)
        svc.repair_reporting_year_plans(db)
    finally:
        db.close()


def _scope_investor_id(user: User, requested: Optional[int] = None) -> Optional[int]:
    if is_manager(user):
        return requested
    if requested is not None and requested != user.investor_id:
        raise HTTPException(status_code=403, detail="אין גישה לנתונים של משקיע אחר")
    return user.investor_id


@router.post("/seed")
def seed(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return svc.seed_defaults(db)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    investor_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    # Investors always see themselves. Managers may filter to one investor or all.
    if is_manager(user):
        scoped = investor_id
    else:
        scoped = user.investor_id
    return svc.get_dashboard(db, investor_id=scoped)


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    return _serialize_settings(svc.ensure_settings(db))


@router.get("/site-status", response_model=SiteStatusOut)
def get_site_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    """Readable by every logged-in user — drives the global update banner."""
    settings = svc.ensure_settings(db)
    public_url = None
    # Managers see the live tunnel URL so bookmarks stay current after free-tunnel rotates.
    if getattr(user, "role", None) == "manager" or bool(
        getattr(getattr(user, "investor", None), "is_manager", False)
    ):
        public_url = _read_public_url()
    return {
        "site_updating": bool(getattr(settings, "site_updating", False)),
        "site_updating_message": getattr(settings, "site_updating_message", None)
        or "האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.",
        "public_url": public_url,
    }


@router.patch("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    settings = svc.ensure_settings(db)
    data = payload.model_dump(exclude_unset=True)
    # Empty string clears the assistant key; omit field to leave unchanged.
    if "assistant_api_key" in data and data["assistant_api_key"] is not None:
        raw = str(data["assistant_api_key"]).strip()
        data["assistant_api_key"] = raw or None
    if "assistant_provider" in data and data["assistant_provider"]:
        prov = str(data["assistant_provider"]).strip().lower()
        if prov not in {"gemini", "openai"}:
            raise HTTPException(status_code=400, detail="ספק לא נתמך")
        data["assistant_provider"] = prov
    for key, value in data.items():
        setattr(settings, key, value)
    if "manager_display_name" in data:
        manager = db.query(Investor).filter(Investor.is_manager.is_(True)).first()
        if manager:
            manager.name = data["manager_display_name"]
    db.commit()
    db.refresh(settings)
    return _serialize_settings(settings)


def _serialize_settings(settings) -> dict:
    key = (getattr(settings, "assistant_api_key", None) or "").strip()
    return {
        "default_monthly_rate_percent": settings.default_monthly_rate_percent,
        "default_manager_fee_percent": settings.default_manager_fee_percent,
        "default_duration_months": settings.default_duration_months,
        "currency_symbol": settings.currency_symbol,
        "manager_display_name": settings.manager_display_name,
        "site_updating": bool(getattr(settings, "site_updating", False)),
        "site_updating_message": getattr(settings, "site_updating_message", None)
        or "האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.",
        "slack_webhook_url": getattr(settings, "slack_webhook_url", None) or None,
        "assistant_provider": getattr(settings, "assistant_provider", None) or "gemini",
        "assistant_api_key_set": bool(key),
        "assistant_api_key_hint": (f"…{key[-4:]}" if len(key) >= 4 else None) if key else None,
    }


def _read_public_url() -> str | None:
    from pathlib import Path

    for candidate in (
        Path("/workspace/.public-url"),
        Path(__file__).resolve().parents[4] / ".public-url",
        Path.cwd() / ".public-url",
    ):
        try:
            if candidate.is_file():
                value = candidate.read_text(encoding="utf-8").strip() or None
                if value:
                    return value
        except OSError:
            continue
    return None


def _post_slack_open_link(webhook: str, public_url: str) -> tuple[bool, str]:
    import json
    import urllib.error
    import urllib.request

    text = (
        "*תזרים — כניסה מהירה*\n"
        f"<{public_url}|לחצו כאן לפתיחת המערכת>\n"
        f"`{public_url}`"
    )
    payload = {
        "text": text,
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*תזרים — כניסה מהירה לעבודה*",
                },
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "פתח את תזרים", "emoji": True},
                        "url": public_url,
                        "style": "primary",
                    }
                ],
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"קישור חי: `{public_url}`",
                    }
                ],
            },
        ],
    }
    req = urllib.request.Request(
        webhook,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status < 300:
                return True, "נשלח ל-Slack"
            return False, body or f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return False, detail or str(exc)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


@router.post("/announce-public-url", response_model=SlackAnnounceOut)
def announce_public_url(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Post the live public URL to Slack for one-click open from work chat."""
    settings = svc.ensure_settings(db)
    webhook = (getattr(settings, "slack_webhook_url", None) or "").strip()
    public_url = _read_public_url()
    if not public_url:
        raise HTTPException(status_code=400, detail="אין קישור ציבורי פעיל כרגע")
    if not webhook:
        raise HTTPException(
            status_code=400,
            detail="חסר Slack Webhook — הגדירו בהגדרות כדי לשתף לצ'אט העבודה",
        )
    ok, detail = _post_slack_open_link(webhook, public_url)
    if not ok:
        raise HTTPException(status_code=502, detail=f"שליחה ל-Slack נכשלה: {detail}")
    return {"sent": True, "detail": detail, "public_url": public_url}


@router.get("/investors", response_model=list[InvestorOut])
def list_investors(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    query = db.query(Investor).options(
        joinedload(Investor.plans).joinedload(InvestmentPlan.payments),
        joinedload(Investor.user),
    )
    if not is_manager(user):
        query = query.filter(Investor.id == user.investor_id)
    investors = query.order_by(Investor.is_manager.desc(), Investor.name).all()
    return [svc.serialize_investor(i) for i in investors]


@router.post("/investors", response_model=InvestorOut, status_code=201)
def create_investor(
    payload: InvestorCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    data = payload.model_dump(exclude={"email", "username", "password"})
    investor = Investor(**data)
    db.add(investor)
    db.flush()

    try:
        auth_svc.ensure_user_for_investor(
            db,
            investor,
            username=payload.username,
            email=payload.email.strip() if payload.email else None,
            password=payload.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans), joinedload(Investor.user))
        .filter(Investor.id == investor.id)
        .one()
    )
    return svc.serialize_investor(investor)


@router.patch("/investors/{investor_id}", response_model=InvestorOut)
def update_investor(
    investor_id: int,
    payload: InvestorUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if not is_manager(user) and investor_id != user.investor_id:
        raise HTTPException(status_code=403, detail="אין הרשאה")
    # Investors may only update phone/notes on themselves
    if not is_manager(user):
        allowed = payload.model_dump(exclude_unset=True)
        if any(k not in {"phone", "notes"} for k in allowed):
            raise HTTPException(status_code=403, detail="ניתן לעדכן רק טלפון והערות")

    investor = (
        db.query(Investor)
        .options(joinedload(Investor.plans), joinedload(Investor.user))
        .filter(Investor.id == investor_id)
        .first()
    )
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(investor, key, value)
    db.commit()
    db.refresh(investor)
    return svc.serialize_investor(investor)


@router.get("/plans", response_model=list[PlanOut])
def list_plans(
    investor_id: Optional[int] = None,
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    query = db.query(InvestmentPlan).options(
        joinedload(InvestmentPlan.investor),
        joinedload(InvestmentPlan.payments),
        joinedload(InvestmentPlan.source_request),
    )
    if scoped is not None:
        query = query.filter(InvestmentPlan.investor_id == scoped)
    if status:
        query = query.filter(InvestmentPlan.status == status)
    plans = query.order_by(InvestmentPlan.start_date.desc()).all()
    hide_fees = not is_manager(user)
    return [svc.serialize_plan(p, hide_fees=hide_fees) for p in plans]


@router.post("/plans", response_model=PlanOut, status_code=201)
def create_plan(
    payload: PlanCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    investor = db.query(Investor).filter(Investor.id == payload.investor_id).first()
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")

    data = payload.model_dump(exclude={"generate_schedule"})
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        data.get("plan_type") or "monthly",
        data.get("monthly_rate_percent") or 0,
        data.get("savings_rate_percent") or 0,
    )
    data["plan_type"] = kind
    data["monthly_rate_percent"] = monthly_rate
    data["savings_rate_percent"] = savings_rate
    data["accrual_principal"] = float(data.get("principal") or 0)
    data["savings_redeemed_total"] = 0.0
    plan = InvestmentPlan(**data)
    db.add(plan)
    db.commit()
    db.refresh(plan)

    if payload.generate_schedule:
        svc.generate_payment_schedule(db, plan)

    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan.id)
        .one()
    )
    return svc.serialize_plan(plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int,
    payload: PlanUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    old_start = plan.start_date
    old_duration = plan.duration_months
    data = payload.model_dump(exclude_unset=True, exclude={"regenerate_schedule"})
    for key, value in data.items():
        setattr(plan, key, value)
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        getattr(plan, "plan_type", None) or "monthly",
        plan.monthly_rate_percent,
        getattr(plan, "savings_rate_percent", 0.0) or 0.0,
    )
    plan.plan_type = kind
    plan.monthly_rate_percent = monthly_rate
    plan.savings_rate_percent = savings_rate
    # Manager principal edit rebases accrual base (full terms change).
    if "principal" in data:
        plan.accrual_principal = float(plan.principal or 0)
    db.commit()

    start_changed = plan.start_date != old_start
    duration_changed = plan.duration_months != old_duration
    money_changed = any(
        field in data
        for field in (
            "principal",
            "plan_type",
            "monthly_rate_percent",
            "savings_rate_percent",
            "manager_fee_percent",
        )
    )
    should_regen = (
        payload.regenerate_schedule or money_changed or start_changed or duration_changed
    )
    if should_regen:
        # Only move due dates when start/duration were explicitly changed.
        svc.generate_payment_schedule(
            db,
            plan,
            realign_dates=start_changed or duration_changed,
        )

    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan_id)
        .one()
    )
    return svc.serialize_plan(plan)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(
    plan_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    # Clear successor links pointing at this plan so SQLite FK allows delete.
    db.query(InvestmentPlan).filter(
        InvestmentPlan.successor_plan_id == plan_id
    ).update({"successor_plan_id": None}, synchronize_session=False)
    db.query(InvestmentTopupRequest).filter(
        InvestmentTopupRequest.created_plan_id == plan_id
    ).update({"created_plan_id": None}, synchronize_session=False)
    db.delete(plan)
    db.commit()
    return None


def _require_owned_topup(user: User, request: InvestmentTopupRequest) -> None:
    if is_manager(user):
        return
    if request.investor_id != user.investor_id:
        raise HTTPException(status_code=403, detail="אין הרשאה לבקשה הזו")


def _serialize_topup(request, user: User, *, include_signatures: bool = False) -> dict:
    return svc.serialize_topup_request(
        request,
        hide_fees=not is_manager(user),
        include_signatures=include_signatures,
    )


@router.get("/investment-requests", response_model=list[TopupRequestOut])
def list_investment_requests(
    status: Optional[str] = None,
    investor_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    return svc.list_topup_requests(
        db,
        investor_id=scoped,
        status=status,
        hide_fees=not is_manager(user),
    )


@router.get("/investment-requests/{request_id}", response_model=TopupRequestOut)
def get_investment_request(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    request = svc._load_topup_request(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    _require_owned_topup(user, request)
    return _serialize_topup(request, user, include_signatures=True)


@router.post("/investment-requests", response_model=TopupRequestOut, status_code=201)
def create_investment_request(
    payload: TopupRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    if is_manager(user):
        target_id = payload.investor_id or user.investor_id
        if not target_id:
            raise HTTPException(status_code=400, detail="בחרו משקיע לבקשה")
    else:
        target_id = user.investor_id
        if payload.investor_id and payload.investor_id != user.investor_id:
            raise HTTPException(status_code=403, detail="אפשר לפתוח בקשה רק עבור עצמך")
    if not target_id:
        raise HTTPException(status_code=400, detail="אין משקיע משויך לחשבון")
    investor = db.query(Investor).filter(Investor.id == target_id).first()
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")
    try:
        request = svc.create_topup_request(
            db,
            investor=investor,
            amount=payload.amount,
            notes=payload.notes,
            actor_user_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_topup(request, user)


@router.post("/investment-requests/{request_id}/cancel", response_model=TopupRequestOut)
def cancel_investment_request(
    request_id: int,
    payload: TopupRequestDecision = TopupRequestDecision(),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    request = svc._load_topup_request(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    _require_owned_topup(user, request)
    try:
        updated = svc.cancel_topup_request(
            db,
            request=request,
            actor_user_id=user.id,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_topup(updated, user)


@router.post("/investment-requests/{request_id}/reject", response_model=TopupRequestOut)
def reject_investment_request(
    request_id: int,
    payload: TopupRequestDecision = TopupRequestDecision(),
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    request = svc._load_topup_request(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    try:
        updated = svc.reject_topup_request(
            db,
            request=request,
            actor_user_id=user.id,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_topup(updated, user)


@router.post("/investment-requests/{request_id}/approve", response_model=TopupRequestOut)
def approve_investment_request(
    request_id: int,
    payload: TopupRequestApprove,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    request = svc._load_topup_request(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    try:
        updated = svc.approve_topup_request(
            db,
            request=request,
            plan_type=payload.plan_type,
            monthly_rate_percent=payload.monthly_rate_percent,
            savings_rate_percent=payload.savings_rate_percent,
            manager_fee_percent=payload.manager_fee_percent,
            start_date=payload.start_date,
            duration_months=payload.duration_months,
            actor_user_id=user.id,
            principal=payload.principal,
            notes=payload.notes,
            generate_schedule=payload.generate_schedule,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_topup(updated, user)


@router.post("/investment-requests/{request_id}/sign", response_model=TopupRequestOut)
def sign_investment_request(
    request_id: int,
    payload: TopupRequestSign,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    request = svc._load_topup_request(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    if is_manager(user):
        party = "manager"
    else:
        _require_owned_topup(user, request)
        party = "investor"
    try:
        updated = svc.sign_topup_contract(
            db,
            request=request,
            party=party,
            typed_name=payload.typed_name,
            signature_png=payload.signature_png,
            accepted_terms=payload.accepted_terms,
            actor_user_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_topup(updated, user, include_signatures=True)


@router.post("/investment-requests/{request_id}/reverse", response_model=TopupRequestOut)
def reverse_investment_request(
    request_id: int,
    payload: TopupRequestDecision = TopupRequestDecision(),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    request = svc._load_topup_request(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    _require_owned_topup(user, request)
    try:
        updated = svc.reverse_topup_investment(
            db,
            request=request,
            actor_user_id=user.id,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_topup(updated, user)


def _load_plan_for_savings(db: Session, plan_id: int) -> InvestmentPlan:
    plan = (
        db.query(InvestmentPlan)
        .options(
            joinedload(InvestmentPlan.investor),
            joinedload(InvestmentPlan.payments),
            joinedload(InvestmentPlan.savings_actions),
        )
        .filter(InvestmentPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


def _assert_plan_access(user: User, plan: InvestmentPlan) -> None:
    if is_manager(user):
        return
    if plan.investor_id != user.investor_id:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post(
    "/plans/{plan_id}/savings/withdraw",
    response_model=SavingsActionResult,
)
def withdraw_savings(
    plan_id: int,
    payload: SavingsActionRequest,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Pull available savings out of the pot (does not change קרן). Manager only."""
    plan = _load_plan_for_savings(db, plan_id)
    try:
        return svc.redeem_savings(
            db,
            plan=plan,
            action_type="withdraw",
            amount=payload.amount,
            actor_user_id=user.id,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/plans/{plan_id}/savings/transfer-to-principal",
    response_model=SavingsActionResult,
)
def transfer_savings_to_principal(
    plan_id: int,
    payload: SavingsActionRequest,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Move available savings into קרן. Manager only."""
    plan = _load_plan_for_savings(db, plan_id)
    try:
        return svc.redeem_savings(
            db,
            plan=plan,
            action_type="transfer_to_principal",
            amount=payload.amount,
            actor_user_id=user.id,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/plans/{plan_id}/savings/settle",
    response_model=PlanSettleResult,
)
def settle_savings_action(
    plan_id: int,
    payload: PlanSettleRequest,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Redeem savings then close the track or open a new successor plan (manager)."""
    plan = _load_plan_for_savings(db, plan_id)
    if plan.status == "completed":
        raise HTTPException(status_code=400, detail="המסלול כבר סגור")
    try:
        return svc.settle_savings_action(
            db,
            plan=plan,
            action_type=payload.action_type,
            amount=payload.amount,
            outcome=payload.outcome,
            actor_user_id=user.id,
            notes=payload.notes,
            withdraw_remaining=payload.withdraw_remaining,
            compound_savings=payload.compound_savings,
            include_monthly_cash=payload.include_monthly_cash,
            monthly_rate_percent=payload.monthly_rate_percent,
            savings_rate_percent=payload.savings_rate_percent,
            manager_fee_percent=payload.manager_fee_percent,
            new_principal=payload.new_principal,
            new_duration_months=payload.new_duration_months,
            new_start_date=payload.new_start_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/remove-from-calendar-year")
def remove_from_calendar_year(
    year: int = Query(...),
    investor_id: int = Query(...),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Remove an investor from a reporting year so they no longer appear in that year's report."""
    return svc.remove_investor_from_calendar_year(db, year=year, investor_id=investor_id)


@router.post("/plans/{plan_id}/regenerate-schedule", response_model=list[PaymentOut])
def regenerate_schedule(
    plan_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
    realign_dates: bool = Query(default=False),
):
    plan = db.query(InvestmentPlan).filter(InvestmentPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    svc.generate_payment_schedule(db, plan, realign_dates=realign_dates)
    payments = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.plan_id == plan_id)
        .order_by(Payment.month_number)
        .all()
    )
    return [svc.serialize_payment(p) for p in payments]


@router.get("/plans/{plan_id}/status-report")
def plan_status_report(
    plan_id: int,
    year: Optional[int] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    """Month-by-month portfolio status from plan start: cash + savings + cumulative."""
    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not is_manager(user) and plan.investor_id != user.investor_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    report = svc.build_plan_status_report(plan, year=year)
    if not is_manager(user):
        for month in report.get("months") or []:
            month.pop("manager_amount", None)
    return report


@router.post("/sync-payment-amounts")
def sync_all_payment_amounts(
    year: Optional[int] = Query(default=None),
    investor_id: Optional[int] = Query(default=None),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Sync cash amounts on payments to current plan rates without moving dates."""
    # Clip mid-year reporting boards to December so savings don't overlap next year.
    restored = svc.repair_midyear_reporting_plans(db)
    query = db.query(InvestmentPlan).options(
        joinedload(InvestmentPlan.payments),
        joinedload(InvestmentPlan.investor),
    )
    if investor_id is not None:
        query = query.filter(InvestmentPlan.investor_id == investor_id)
    plans = query.all()
    synced = []
    for plan in plans:
        if year is not None:
            has_year = any(
                p.due_date and p.due_date.year == year for p in (plan.payments or [])
            ) or (plan.start_date and plan.start_date.year == year)
            if not has_year:
                continue
        result = svc.sync_payment_amounts(db, plan)
        # Also fill any missing months without moving dates.
        svc.generate_payment_schedule(db, plan, realign_dates=False)
        synced.append(
            {
                "plan_id": plan.id,
                "investor_id": plan.investor_id,
                "investor_name": plan.investor.name if plan.investor else "",
                **result,
            }
        )
    return {
        "year": year,
        "synced": synced,
        "count": len(synced),
        "reporting_plans_clipped": restored.get("clipped", 0),
        "reporting_plans_restored": restored.get("restored", 0),
    }


@router.get("/payments", response_model=list[PaymentOut])
def list_payments(
    investor_id: Optional[int] = None,
    plan_id: Optional[int] = None,
    status: Optional[str] = None,
    year: Optional[int] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    query = db.query(Payment).options(joinedload(Payment.investor))
    if scoped is not None:
        query = query.filter(Payment.investor_id == scoped)
    if plan_id is not None:
        query = query.filter(Payment.plan_id == plan_id)
    if status:
        query = query.filter(Payment.status == status)
    if year is not None:
        query = query.filter(
            Payment.due_date >= date(year, 1, 1),
            Payment.due_date <= date(year, 12, 31),
        )
        payments = query.order_by(Payment.due_date.asc(), Payment.id.asc()).all()
    else:
        payments = query.order_by(Payment.due_date.desc(), Payment.id.desc()).all()

    # Safety net: never return two rows for the same investor on the same due date.
    priority = {
        "paid": 3,
        "awaiting_confirmation": 2,
        "scheduled": 1,
        "skipped": 0,
    }
    unique: dict[tuple[int, date], Payment] = {}
    for payment in payments:
        key = (payment.investor_id, payment.due_date)
        prior = unique.get(key)
        if prior is None or priority.get(payment.status, 0) > priority.get(prior.status, 0):
            unique[key] = payment
    ordered = sorted(
        unique.values(),
        key=lambda p: (p.due_date, p.id),
        reverse=year is None,
    )
    return [svc.serialize_payment(p) for p in ordered]


@router.get("/manager-income")
def manager_income(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Manager-only: fee from each investor + own (Sahar) investment return per month."""
    return svc.get_manager_income_board(db)


@router.get("/payment-report", response_model=PaymentReportOut)
def payment_report(
    year: int = Query(...),
    investor_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    scoped = _scope_investor_id(user, investor_id)
    return svc.get_payment_report(db, year=year, investor_id=scoped)


@router.post("/open-calendar-year")
def open_calendar_year(
    year: int = Query(...),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Open a Jan–Dec reporting year for all investors who already have a plan."""
    try:
        return svc.open_calendar_year_plans(db, year=year)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/payments/mark-year-paid")
def mark_year_paid(
    year: int = Query(...),
    investor_id: Optional[int] = None,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Send confirmation requests for all scheduled payments in a calendar year."""
    return svc.mark_year_payments_paid(
        db, year=year, investor_id=investor_id, actor=user
    )


@router.post("/align-calendar-year")
def align_calendar_year(
    year: Optional[int] = Query(default=None),
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    """Align active plans to 1 Jan–Dec of the calendar year."""
    return svc.align_plans_to_calendar_year(db, year=year)


@router.patch("/payments/{payment_id}", response_model=PaymentOut)
def update_payment(
    payment_id: int,
    payload: PaymentUpdate,
    user: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    payment = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    data = payload.model_dump(exclude_unset=True)

    # Manager "mark paid" becomes a confirmation request to the investor.
    if data.get("status") == "paid":
        svc.request_payment_confirmation(db, payment=payment, actor=user)
        db.refresh(payment)
        return svc.serialize_payment(payment)

    if data.get("status") in {"scheduled", "skipped"}:
        data["paid_at"] = None
    for key, value in data.items():
        setattr(payment, key, value)
    db.commit()
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.post("/payments/{payment_id}/confirm", response_model=PaymentOut)
def confirm_payment(
    payment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    payment = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    try:
        svc.confirm_payment(db, payment=payment, actor=user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.post("/payments/{payment_id}/reject", response_model=PaymentOut)
def reject_payment(
    payment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_investment_db),
):
    payment = (
        db.query(Payment)
        .options(joinedload(Payment.investor))
        .filter(Payment.id == payment_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    try:
        svc.reject_payment_confirmation(db, payment=payment, actor=user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(payment)
    return svc.serialize_payment(payment)


@router.get("/quotes", response_model=list[QuoteOut])
def list_quotes(
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quotes = db.query(Quote).order_by(Quote.created_at.desc()).all()
    return [svc.serialize_quote(q) for q in quotes]


@router.post("/quotes", response_model=QuoteOut, status_code=201)
def create_quote(
    payload: QuoteCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    data = payload.model_dump()
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        data.get("plan_type") or "monthly",
        data.get("monthly_rate_percent") or 0,
        data.get("savings_rate_percent") or 0,
    )
    data["plan_type"] = kind
    data["monthly_rate_percent"] = monthly_rate
    data["savings_rate_percent"] = savings_rate
    data["phone"] = (data.get("phone") or "").strip() or None
    quote = Quote(**data)
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return svc.serialize_quote(quote)


@router.patch("/quotes/{quote_id}", response_model=QuoteOut)
def update_quote(
    quote_id: int,
    payload: QuoteUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "phone":
            value = (value or "").strip() or None
        setattr(quote, key, value)
    kind, monthly_rate, savings_rate = svc.normalize_plan_rates(
        getattr(quote, "plan_type", None) or "monthly",
        quote.monthly_rate_percent,
        getattr(quote, "savings_rate_percent", 0.0) or 0.0,
    )
    quote.plan_type = kind
    quote.monthly_rate_percent = monthly_rate
    quote.savings_rate_percent = savings_rate
    db.commit()
    db.refresh(quote)
    return svc.serialize_quote(quote)


@router.delete("/quotes/{quote_id}", status_code=204)
def delete_quote(
    quote_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote.status == "converted":
        raise HTTPException(
            status_code=400,
            detail="לא ניתן למחוק הצעה שכבר הומרה למשקיע",
        )
    db.delete(quote)
    db.commit()
    return None


@router.post("/quotes/{quote_id}/convert", response_model=PlanOut)
def convert_quote(
    quote_id: int,
    payload: QuoteConvert,
    _: User = Depends(require_manager),
    db: Session = Depends(get_investment_db),
):
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote.status == "converted":
        raise HTTPException(status_code=400, detail="Quote already converted")

    investor = Investor(
        name=quote.prospect_name,
        phone=payload.phone or quote.phone,
        notes=payload.notes or quote.notes,
    )
    db.add(investor)
    db.flush()

    plan = InvestmentPlan(
        investor_id=investor.id,
        principal=quote.principal,
        plan_type=getattr(quote, "plan_type", None) or "monthly",
        monthly_rate_percent=quote.monthly_rate_percent,
        savings_rate_percent=getattr(quote, "savings_rate_percent", 0.0) or 0.0,
        manager_fee_percent=quote.manager_fee_percent,
        start_date=payload.start_date,
        duration_months=quote.duration_months,
        notes=quote.notes,
        status="active",
    )
    db.add(plan)
    quote.status = "converted"
    quote.converted_investor_id = investor.id
    auth_svc.ensure_user_for_investor(
        db,
        investor,
        username=payload.username,
        email=payload.email,
        password=payload.password,
    )
    db.commit()
    db.refresh(plan)

    svc.generate_payment_schedule(db, plan)
    plan = (
        db.query(InvestmentPlan)
        .options(joinedload(InvestmentPlan.investor), joinedload(InvestmentPlan.payments))
        .filter(InvestmentPlan.id == plan.id)
        .one()
    )
    return svc.serialize_plan(plan)
