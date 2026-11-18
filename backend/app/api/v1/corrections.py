"""Admin corrections hub: everything that can still be undone or changed, in one place.

Read-only aggregation. Every undo it lists is performed by the existing, guarded
endpoints (wallet reversal, notice/agreement cancellation, payment status), each of
which keeps the original record and writes an activity-log entry.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.api.v1.agreements import notice_block_reason
from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.models.investments import (
    InvestmentPlan,
    InvestmentTopupRequest,
    Investor,
    Payment,
    PlanAgreement,
    PlanNotice,
    WalletEntry,
)
from app.security.auth import is_system_admin, require_manager
from app.services import investment_service as svc
from app.services import wallet_service as wallet_svc

router = APIRouter(prefix="/api/v1/investments/admin", tags=["admin-corrections"])

WALLET_WINDOW_DAYS = 180
CONFIRMED_WINDOW_DAYS = 60


def _iso(value):
    return value.isoformat() if value is not None else None


@router.get("/corrections")
def corrections(user: User = Depends(require_manager), db: Session = Depends(get_investment_db)):
    admin = is_system_admin(user)
    names = {row.id: row.name for row in db.query(Investor.id, Investor.name).all()}
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today = svc.israel_today()

    # Wallet movements the admin entered by hand (one row per transfer).
    since = now - timedelta(days=WALLET_WINDOW_DAYS)
    entries = (
        db.query(WalletEntry)
        .filter(WalletEntry.operation_type.in_(("deposit", "withdraw", "transfer_out")),
                WalletEntry.created_at >= since)
        .order_by(WalletEntry.id.desc())
        .limit(60)
        .all()
    )
    done = wallet_svc.reversed_keys(db, [wallet_svc.reversal_key(row) for row in entries])
    wallet_rows = []
    for row in entries:
        reversed_already = wallet_svc.reversal_key(row) in done
        if reversed_already:
            continue
        block = wallet_svc.reversal_block_reason(db, row, already_reversed=False)
        if not admin:
            block = block or "ביטול תנועות ביתרה זמין למנהל המערכת בלבד"
        wallet_rows.append({
            "id": row.id, "investor_id": row.investor_id, "investor_name": row.investor_name,
            "type": row.operation_type, "amount": row.amount_cents / 100,
            "counterparty_name": row.counterparty_name, "created_at": _iso(row.created_at),
            "notes": row.admin_notes if admin else None,
            "reversible": block is None, "blocked_reason": block,
        })

    # Agreements waiting for signature: cancel, re-issue the link, or (admin) revise.
    pending = (
        db.query(PlanAgreement)
        .filter(PlanAgreement.status == "pending")
        .order_by(PlanAgreement.id.desc())
        .all()
    )
    agreement_rows = []
    for row in pending:
        expires = row.expires_at.replace(tzinfo=None) if row.expires_at else None
        agreement_rows.append({
            "id": row.id, "investor_id": row.investor_id, "investor_name": names.get(row.investor_id, ""),
            "kind": row.kind, "title": (row.snapshot or {}).get("title", "הסכם"), "plan_id": row.plan_id,
            "created_at": _iso(row.created_at), "expires_at": _iso(row.expires_at),
            "expired": bool(expires and expires < now),
            "can_cancel": row.kind == "open" or admin,
            "can_revise": admin and row.kind == "open" and row.plan_id is None,
            "principal": ((row.snapshot or {}).get("terms") or {}).get("principal"),
        })

    # Recorded requests that were not used yet.
    notices = (
        db.query(PlanNotice)
        .filter(PlanNotice.cancelled_at.is_(None))
        .order_by(PlanNotice.id.desc())
        .limit(80)
        .all()
    )
    notice_rows = []
    for row in notices:
        block = notice_block_reason(db, row)
        if block and "ממתין לחתימה" not in block:
            continue  # used by a signed agreement or a withdrawal — permanent history
        notice_rows.append({
            "id": row.id, "investor_id": row.investor_id, "investor_name": names.get(row.investor_id, ""),
            "purpose": row.purpose, "requested_on": _iso(row.requested_on),
            "eligible_on": _iso(svc.add_months(row.requested_on, 1) if row.purpose == "withdraw" else row.requested_on),
            "created_at": _iso(row.created_at), "cancellable": block is None, "blocked_reason": block,
        })

    # Payments: pending confirmation requests and recently confirmed payments.
    closed_plan_ids = {pid for (pid,) in db.query(InvestmentPlan.id).filter(InvestmentPlan.closed_on.isnot(None)).all()}
    awaiting = (
        db.query(Payment)
        .filter(Payment.status == "awaiting_confirmation")
        .order_by(Payment.due_date.asc())
        .all()
    )
    confirmed = (
        db.query(Payment)
        .filter(Payment.status == "paid", Payment.paid_at >= today - timedelta(days=CONFIRMED_WINDOW_DAYS))
        .order_by(Payment.paid_at.desc())
        .limit(60)
        .all()
    )

    def payment_row(p: Payment) -> dict:
        return {
            "id": p.id, "plan_id": p.plan_id, "investor_id": p.investor_id,
            "investor_name": names.get(p.investor_id, ""), "month_number": p.month_number,
            "due_date": _iso(p.due_date), "paid_at": _iso(p.paid_at), "status": p.status,
            "investor_amount": p.investor_amount,
            "confirmation_requested_at": _iso(p.confirmation_requested_at),
            "plan_closed": p.plan_id in closed_plan_ids,
        }

    # Track requests still in progress.
    topups = (
        db.query(InvestmentTopupRequest)
        .options(joinedload(InvestmentTopupRequest.investor))
        .filter(InvestmentTopupRequest.status.in_(("pending", "contract")))
        .order_by(InvestmentTopupRequest.id.desc())
        .all()
    )
    topup_rows = [{
        "id": r.id, "investor_id": r.investor_id, "investor_name": r.investor.name if r.investor else "",
        "amount": r.amount, "status": r.status, "created_at": _iso(r.created_at),
    } for r in topups]

    return {
        "is_system_admin": admin,
        "wallet_window_days": WALLET_WINDOW_DAYS,
        "confirmed_window_days": CONFIRMED_WINDOW_DAYS,
        "wallet": wallet_rows,
        "agreements": agreement_rows,
        "notices": notice_rows,
        "awaiting_payments": [payment_row(p) for p in awaiting if p.plan_id not in closed_plan_ids],
        "confirmed_payments": [payment_row(p) for p in confirmed if p.plan_id not in closed_plan_ids],
        "topups": topup_rows,
    }


def _money(value: float) -> str:
    return f"{value:,.2f} ₪"


@router.get("/integrity")
def integrity(user: User = Depends(require_manager), db: Session = Depends(get_investment_db)):
    """Read-only consistency check. Reports mismatches; never changes any figure."""
    issues: list[dict] = []

    def add(severity: str, area: str, investor: str, title: str, details: str, href: str | None = None):
        issues.append({"severity": severity, "area": area, "investor_name": investor,
                       "title": title, "details": details, "href": href})

    investors = db.query(Investor).all()
    names = {inv.id: inv.name for inv in investors}

    # 1) Available balance vs. its ledger.
    sums: dict[int, int] = {}
    last: dict[int, WalletEntry] = {}
    for entry in db.query(WalletEntry).filter(WalletEntry.investor_id.isnot(None)).order_by(WalletEntry.id).all():
        sums[entry.investor_id] = sums.get(entry.investor_id, 0) + entry.amount_cents
        last[entry.investor_id] = entry
    for inv in investors:
        balance = inv.available_balance_cents or 0
        href = f"/investors?investor_id={inv.id}&section=balance"
        if inv.id in sums:
            if sums[inv.id] != balance:
                add("error", "יתרה זמינה", inv.name, "היתרה אינה תואמת לסכום התנועות",
                    f"יתרה רשומה {_money(balance / 100)} · סכום התנועות {_money(sums[inv.id] / 100)}", href)
            elif last[inv.id].balance_after_cents != balance:
                add("error", "יתרה זמינה", inv.name, "היתרה אינה תואמת לתנועה האחרונה",
                    f"יתרה רשומה {_money(balance / 100)} · אחרי התנועה האחרונה {_money(last[inv.id].balance_after_cents / 100)}", href)
        elif balance != 0:
            add("warning", "יתרה זמינה", inv.name, "יתרה ללא תנועות מתועדות",
                f"יתרה רשומה {_money(balance / 100)} ללא היסטוריית תנועות (ייתכן שמקורה בייבוא ישן)", href)

    # 2) Plans and their payment schedules.
    plans = (db.query(InvestmentPlan)
             .options(joinedload(InvestmentPlan.payments), joinedload(InvestmentPlan.agreements))
             .all())
    checked_payments = 0
    for plan in plans:
        inv_name = names.get(plan.investor_id, "")
        href = f"/investors?investor_id={plan.investor_id}&plan_id={plan.id}"
        payments = list(plan.payments or [])
        if plan.closed_on is None and plan.status == "active":
            _, cash_rate, _ = svc.normalize_plan_rates(plan.plan_type or "monthly", plan.monthly_rate_percent,
                                                       plan.savings_rate_percent or 0)
            expected_cash = svc.calc_monthly(plan.principal, cash_rate)
            expected_fee = svc.calc_monthly(plan.principal, plan.manager_fee_percent)
            off = [p for p in payments if p.status in {"scheduled", "awaiting_confirmation"}
                   and (abs(p.investor_amount - expected_cash) > 0.005 or abs(p.manager_amount - expected_fee) > 0.005)]
            checked_payments += len(payments)
            if off:
                sample = off[0]
                add("error", "תשלומים", inv_name, f"סכומי תשלום אינם תואמים לתנאי מסלול #{plan.id}",
                    f"{len(off)} תשלומים פתוחים · צפוי {_money(expected_cash)} למשקיע ו־{_money(expected_fee)} עמלה · "
                    f"לדוגמה חודש {sample.month_number}: {_money(sample.investor_amount)} / {_money(sample.manager_amount)}", href)
            months = sorted(p.month_number for p in payments)
            expected_months = svc.plan_effective_duration(plan)
            missing = sorted(set(range(1, expected_months + 1)) - set(months))
            extra = [m for m in months if m > plan.duration_months]
            if missing:
                add("warning", "תשלומים", inv_name, f"חסרים חודשים בלוח התשלומים של מסלול #{plan.id}",
                    f"חסרים {len(missing)} חודשים (למשל {', '.join(map(str, missing[:5]))})", href)
            if extra:
                add("warning", "תשלומים", inv_name, f"תשלומים מעבר למשך מסלול #{plan.id}",
                    f"חודשים {', '.join(map(str, extra[:5]))} מעבר ל־{plan.duration_months} חודשים", href)
        # Signed opening agreement vs. the plan it created.
        for agreement in plan.agreements or []:
            if agreement.kind != "open" or agreement.status != "signed":
                continue
            terms = (agreement.snapshot or {}).get("terms") or {}
            diffs = []
            for key, label in (("principal", "קרן"), ("monthly_rate_percent", "אחוז מזומן"),
                               ("savings_rate_percent", "אחוז חיסכון"), ("duration_months", "משך")):
                if key in terms and terms[key] is not None and abs(float(terms[key]) - float(getattr(plan, key) or 0)) > 0.005:
                    diffs.append(f"{label}: בהסכם {terms[key]} · במסלול {getattr(plan, key)}")
            if diffs:
                add("error", "הסכמים", inv_name, f"מסלול #{plan.id} שונה מההסכם החתום #{agreement.id}", " · ".join(diffs), href)
        # Closed plan vs. the credit it produced.
        if plan.closed_on is not None and plan.closing_principal_cents is not None:
            credit = db.query(WalletEntry).filter(WalletEntry.operation_key == f"close:{plan.id}").first()
            expected = (plan.closing_principal_cents or 0) + (plan.closing_savings_cents or 0)
            if credit is None:
                add("error", "סגירת מסלול", inv_name, f"לא נמצא זיכוי ליתרה עבור סגירת מסלול #{plan.id}",
                    f"צפוי זיכוי של {_money(expected / 100)}", href)
            elif credit.amount_cents != expected:
                add("error", "סגירת מסלול", inv_name, f"זיכוי הסגירה של מסלול #{plan.id} אינו תואם",
                    f"זוכה {_money(credit.amount_cents / 100)} · צפוי {_money(expected / 100)}", href)

    order = {"error": 0, "warning": 1}
    issues.sort(key=lambda row: (order.get(row["severity"], 2), row["investor_name"]))
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "investors": len(investors),
        "plans": len(plans),
        "payments": checked_payments,
        "errors": sum(1 for row in issues if row["severity"] == "error"),
        "warnings": sum(1 for row in issues if row["severity"] == "warning"),
        "issues": issues,
    }
