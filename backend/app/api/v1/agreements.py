from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.models.investments import Investor, InvestmentPlan, PlanAgreement, PlanNotice
from app.schemas.investments import PlanCreate
from app.security.auth import get_current_user, is_manager, is_system_admin, require_manager, require_system_admin, verify_password
from app.services import agreement_service as svc

router = APIRouter(prefix="/api/v1/investments", tags=["agreements"])


class NoticeInput(BaseModel):
    purpose: str = Field(pattern="^(withdraw|renew|new)$")
    requested_on: date | None = None
    notes: str | None = Field(default=None, max_length=1000)


class OpeningInput(PlanCreate):
    notice_id: int


class ClosingInput(BaseModel):
    notice_id: int
    reviewed_document_hash: str | None = Field(default=None, min_length=64, max_length=64)


class ClosingPreviewInput(BaseModel):
    requested_on: date


class TokenInput(BaseModel):
    token: str = Field(min_length=40, max_length=100)


class SigningInput(TokenInput):
    password: str = Field(min_length=1, max_length=128)
    typed_name: str = Field(min_length=2, max_length=80)
    signature_png: str = Field(max_length=500000)
    accepted_terms: bool
    document_hash: str = Field(min_length=64, max_length=64)


def fail(db, exc):
    db.rollback()
    raise HTTPException(status_code=409, detail=str(exc) if isinstance(exc, ValueError) else "הנתונים השתנו. רעננו ונסו שוב") from exc


def owned(user, investor_id):
    if not is_manager(user) and user.investor_id != investor_id:
        raise HTTPException(status_code=403, detail="אין הרשאה לתיק זה")


@router.get("/investors/{investor_id}/notices")
def notices(investor_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    owned(user, investor_id)
    return [{"id": n.id, "purpose": n.purpose, "requested_on": n.requested_on, "eligible_on": svc.svc.add_months(n.requested_on, 1), "notes": n.notes}
            for n in db.query(PlanNotice).filter(PlanNotice.investor_id == investor_id).order_by(PlanNotice.id.desc()).all()]


@router.post("/investors/{investor_id}/notices", status_code=201)
def create_notice(investor_id: int, payload: NoticeInput, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    owned(user, investor_id)
    if not db.get(Investor, investor_id):
        raise HTTPException(status_code=404, detail="המשקיע לא נמצא")
    requested = payload.requested_on or svc.israel_today()
    if requested > svc.israel_today() or (not is_manager(user) and requested != svc.israel_today()):
        raise HTTPException(status_code=409, detail="תאריך בקשה אינו תקין")
    row = PlanNotice(investor_id=investor_id, purpose=payload.purpose, requested_on=requested, notes=payload.notes, actor_user_id=user.id)
    db.add(row); db.commit()
    return {"id": row.id, "purpose": row.purpose, "requested_on": row.requested_on, "eligible_on": svc.svc.add_months(row.requested_on, 1)}


@router.post("/agreements/open", status_code=201)
def opening(payload: OpeningInput, user: User = Depends(require_manager), db: Session = Depends(get_investment_db)):
    try:
        row, token = svc.issue(db, investor_id=payload.investor_id, kind="open", actor_id=user.id, notice_id=payload.notice_id,
                               data=payload.model_dump(exclude={"notice_id"}))
        db.commit()
        return {**svc.serialize(row), "token": token}
    except (ValueError, IntegrityError) as exc:
        fail(db, exc)


@router.post("/plans/{plan_id}/closing-agreement", status_code=201)
def closing(plan_id: int, payload: ClosingInput, user: User = Depends(require_system_admin), db: Session = Depends(get_investment_db)):
    plan = db.get(InvestmentPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="המסלול לא נמצא")
    if not payload.reviewed_document_hash:
        raise HTTPException(status_code=409, detail="יש להציג ולאשר את סיכום הסיום לפני הכנת ההסכם")
    try:
        row, token = svc.issue(db, investor_id=plan.investor_id, kind="close", actor_id=user.id, notice_id=payload.notice_id, plan_id=plan_id)
        if row.document_hash != payload.reviewed_document_hash:
            raise ValueError("נתוני הסיום השתנו. יש לעיין בסיכום המעודכן ולאשר אותו שוב")
        db.commit()
        return {**svc.serialize(row), "token": token}
    except (ValueError, IntegrityError) as exc:
        fail(db, exc)


@router.post("/plans/{plan_id}/closing-preview")
def closing_preview(plan_id: int, payload: ClosingPreviewInput, user: User = Depends(require_system_admin), db: Session = Depends(get_investment_db)):
    plan = db.get(InvestmentPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="המסלול לא נמצא")
    try:
        return svc.closing_preview(db, plan, payload.requested_on)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/investors/{investor_id}/agreements")
def history(investor_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    owned(user, investor_id)
    return [svc.serialize(n) for n in db.query(PlanAgreement).filter(PlanAgreement.investor_id == investor_id).order_by(PlanAgreement.id.desc()).all()]


@router.get("/agreements/{agreement_id}")
def detail(agreement_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_investment_db)):
    row = db.get(PlanAgreement, agreement_id)
    if not row:
        raise HTTPException(status_code=404, detail="המסמך לא נמצא")
    owned(user, row.investor_id)
    return svc.serialize(row)


@router.post("/agreements/{agreement_id}/link")
def new_link(agreement_id: int, user: User = Depends(require_manager), db: Session = Depends(get_investment_db)):
    import hashlib, secrets
    from datetime import timedelta
    row = db.query(PlanAgreement).filter(PlanAgreement.id == agreement_id).with_for_update().first()
    if not row or row.status != "pending":
        raise HTTPException(status_code=409, detail="אין הסכם הממתין לחתימה")
    if row.kind == "close" and not is_system_admin(user):
        raise HTTPException(status_code=403, detail="הסכמי סיום זמינים לניהול האדמין בלבד")
    token = secrets.token_urlsafe(32)
    row.token_hash = hashlib.sha256(token.encode()).hexdigest()
    row.failed_attempts = 0
    row.expires_at = svc.utcnow() + timedelta(days=14)
    db.commit()
    return {"token": token}


@router.post("/agreements/{agreement_id}/cancel")
def cancel(agreement_id: int, user: User = Depends(require_manager), db: Session = Depends(get_investment_db)):
    row = db.get(PlanAgreement, agreement_id)
    if not row:
        raise HTTPException(status_code=404, detail="המסמך לא נמצא")
    if row.kind == "close" and not is_system_admin(user):
        raise HTTPException(status_code=403, detail="הסכמי סיום זמינים לניהול האדמין בלבד")
    svc.wallet.lock_investor(db, row.investor_id)
    db.refresh(row)
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="אפשר לבטל רק הסכם שטרם נחתם")
    row.status = "cancelled"; db.commit()
    return svc.serialize(row)


def public_enabled():
    if settings.admin_only_maintenance:
        raise HTTPException(status_code=503, detail="המערכת בעדכון. החתימה תהיה זמינה לאחר סיום התחזוקה")


@router.post("/agreement-public/read")
def public_read(payload: TokenInput, db: Session = Depends(get_investment_db)):
    public_enabled()
    try:
        return svc.serialize(svc.by_token(db, payload.token))
    except ValueError as exc:
        fail(db, exc)


@router.post("/agreement-public/sign")
def public_sign(payload: SigningInput, db: Session = Depends(get_investment_db)):
    public_enabled()
    try:
        row = svc.by_token(db, payload.token)
        svc.wallet.lock_investor(db, row.investor_id)
        row = db.query(PlanAgreement).filter(PlanAgreement.id == row.id).with_for_update().populate_existing().one()
        import hashlib
        if row.token_hash != hashlib.sha256(payload.token.encode()).hexdigest():
            raise ValueError("הקישור הוחלף. יש להשתמש בקישור העדכני מהמנהל")
        if row.failed_attempts >= 5:
            raise HTTPException(status_code=429, detail="הקישור ננעל לאחר ניסיונות אימות. יש לבקש מהמנהל קישור חדש")
        signer = db.query(User).filter(User.investor_id == row.investor_id, User.is_active.is_(True)).first()
        if not signer or not verify_password(payload.password, signer.password_hash):
            row.failed_attempts += 1
            db.commit()
            raise HTTPException(status_code=403, detail="סיסמת המשקיע אינה תקינה")
        result = svc.sign(db, row, name=payload.typed_name, signature=payload.signature_png,
                          accepted=payload.accepted_terms, document_hash=payload.document_hash)
        result.signer_user_id = signer.id
        db.commit()
        return svc.serialize(result)
    except (ValueError, IntegrityError) as exc:
        fail(db, exc)
