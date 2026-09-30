"""Seed pre-existing portfolio records for tests of payments and historical reports.

These records represent imports/history, not new client contracts. New activation
and signature requirements are exercised through the real API in test_agreements.
"""
from datetime import date
from types import SimpleNamespace

from app.db.investment_session import InvestmentSessionLocal
from app.models.investments import InvestmentPlan
from app.services import investment_service as svc


def with_notice(data: dict) -> dict:
    start = date.fromisoformat(data.get("start_date") or date.today().isoformat())
    received = min(svc.add_months(start, -1), date.today())
    return {**data, "notice_requested_on": received.isoformat()}


def seed_legacy_plan(*, json: dict, headers=None):
    del headers
    data = dict(json)
    schedule = data.pop("generate_schedule", True)
    data.pop("additional_funds", None); data.pop("operation_key", None)
    data.setdefault("plan_type", "monthly"); data.setdefault("savings_rate_percent", 0)
    data["start_date"] = date.fromisoformat(data["start_date"])
    data.setdefault("accrual_principal", data["principal"])
    with InvestmentSessionLocal() as db:
        plan = InvestmentPlan(**data)
        db.add(plan); db.flush()
        if schedule: svc.generate_payment_schedule(db, plan, commit=False)
        db.commit(); db.refresh(plan)
        result = svc.serialize_plan(plan)
    return SimpleNamespace(status_code=201, text=str(result), json=lambda: result)
