from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.investments import InvestmentTopupRequest
from app.security.auth import hash_password
from app.services import investment_service as inv_svc
from app.services.investment_service import (
    add_israel_business_days,
    cooling_off_deadline_utc,
    israel_business_days_remaining,
    is_israel_business_day,
)

client = TestClient(app)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _login(email: str, password: str) -> tuple[dict, int]:
    _ensure_seeded()
    username_map = {
        "sahar9shely@gmail.com": "sahar",
        "bar050297@gmail.com": "bar",
    }
    username = username_map.get(email, email.split("@")[0].lower())
    db = InvestmentSessionLocal()
    try:
        from app.models.auth import User

        user = db.query(User).filter(User.username == username).first()
        assert user is not None, username
        user.password_hash = hash_password(password)
        user.must_reset_password = False
        db.commit()
        investor_id = user.investor_id
    finally:
        db.close()
    login = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return headers, investor_id


def _clear_pending(investor_id: int) -> None:
    db = InvestmentSessionLocal()
    try:
        rows = (
            db.query(InvestmentTopupRequest)
            .filter(
                InvestmentTopupRequest.investor_id == investor_id,
                InvestmentTopupRequest.status == "pending",
            )
            .all()
        )
        for row in rows:
            row.status = "cancelled"
        db.commit()
    finally:
        db.close()


def test_israel_business_days_skip_weekend():
    thursday = date(2026, 8, 13)  # Thursday
    assert is_israel_business_day(thursday)
    assert add_israel_business_days(thursday, 3) == date(2026, 8, 18)  # Tue
    sunday = date(2026, 8, 16)
    assert add_israel_business_days(sunday, 3) == date(2026, 8, 19)  # Wed


def test_investor_topup_request_approve_hides_fee_and_creates_plan():
    manager, _ = _login("sahar9shely@gmail.com", "ManagerPass1!")
    investor, investor_id = _login("bar050297@gmail.com", "InvestorPass1!")
    _clear_pending(investor_id)

    created = client.post(
        "/api/v1/investments/investment-requests",
        headers=investor,
        json={"amount": 25000, "notes": "תוספת לבדיקה"},
    )
    assert created.status_code == 201, created.text
    request = created.json()
    assert request["status"] == "pending"
    assert request["amount"] == 25000
    assert "manager_fee_percent" not in request

    duplicate = client.post(
        "/api/v1/investments/investment-requests",
        headers=investor,
        json={"amount": 1000},
    )
    assert duplicate.status_code == 400

    queue = client.get("/api/v1/investments/investment-requests", headers=manager).json()
    assert any(row["id"] == request["id"] and row["status"] == "pending" for row in queue)

    approved = client.post(
        f"/api/v1/investments/investment-requests/{request['id']}/approve",
        headers=manager,
        json={
            "plan_type": "monthly",
            "monthly_rate_percent": 1.5,
            "savings_rate_percent": 0,
            "manager_fee_percent": 0.8,
            "start_date": "2041-06-01",
            "duration_months": 12,
            "notes": "מסלול מאושר לבדיקה",
        },
    )
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "approved"
    assert body["created_plan_id"]
    assert body["manager_fee_percent"] == 0.8
    assert body["can_reverse_investment"] is True

    investor_view = client.get(
        "/api/v1/investments/investment-requests", headers=investor
    ).json()
    mine = next(row for row in investor_view if row["id"] == request["id"])
    assert "manager_fee_percent" not in mine
    assert mine["status"] == "approved"
    assert mine["plan"]
    assert "manager_fee_percent" not in mine["plan"]
    assert "monthly_manager_fee" not in mine["plan"]
    assert mine["plan"]["monthly_rate_percent"] == 1.5
    assert mine["can_reverse_investment"] is True

    plans = client.get("/api/v1/investments/plans", headers=investor).json()
    plan = next(p for p in plans if p["id"] == body["created_plan_id"])
    assert plan["principal"] == 25000
    assert plan["status"] == "active"
    assert "manager_fee_percent" not in plan
    assert plan["can_cancel_investment"] is True

    manager_plans = client.get("/api/v1/investments/plans", headers=manager).json()
    manager_plan = next(p for p in manager_plans if p["id"] == body["created_plan_id"])
    assert manager_plan["manager_fee_percent"] == 0.8

    reversed_req = client.post(
        f"/api/v1/investments/investment-requests/{request['id']}/reverse",
        headers=investor,
        json={},
    )
    assert reversed_req.status_code == 200, reversed_req.text
    assert reversed_req.json()["status"] == "reversed"

    plans_after = client.get("/api/v1/investments/plans", headers=investor).json()
    closed = next(p for p in plans_after if p["id"] == body["created_plan_id"])
    assert closed["status"] == "completed"
    assert closed["can_cancel_investment"] is False


def test_cancel_pending_topup_request():
    investor, investor_id = _login("bar050297@gmail.com", "InvestorPass1!")
    _clear_pending(investor_id)
    created = client.post(
        "/api/v1/investments/investment-requests",
        headers=investor,
        json={"amount": 8000, "notes": "לבטל"},
    )
    assert created.status_code == 201, created.text
    cancelled = client.post(
        f"/api/v1/investments/investment-requests/{created.json()['id']}/cancel",
        headers=investor,
        json={},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"


def test_reverse_after_cooling_off_fails():
    manager, _ = _login("sahar9shely@gmail.com", "ManagerPass1!")
    investor, investor_id = _login("bar050297@gmail.com", "InvestorPass1!")
    _clear_pending(investor_id)
    created = client.post(
        "/api/v1/investments/investment-requests",
        headers=investor,
        json={"amount": 12000},
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    approved = client.post(
        f"/api/v1/investments/investment-requests/{request_id}/approve",
        headers=manager,
        json={
            "monthly_rate_percent": 1,
            "manager_fee_percent": 0.4,
            "start_date": "2042-02-01",
            "duration_months": 12,
        },
    )
    assert approved.status_code == 200, approved.text
    plan_id = approved.json()["created_plan_id"]

    db = InvestmentSessionLocal()
    try:
        row = db.query(InvestmentTopupRequest).filter(InvestmentTopupRequest.id == request_id).one()
        row.cancel_until = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
        db.commit()
    finally:
        db.close()

    too_late = client.post(
        f"/api/v1/investments/investment-requests/{request_id}/reverse",
        headers=investor,
        json={},
    )
    assert too_late.status_code == 400

    client.delete(f"/api/v1/investments/plans/{plan_id}", headers=manager)


def test_cooling_off_deadline_is_three_business_days():
    approved = datetime(2026, 8, 13, 10, 0, tzinfo=timezone.utc)  # Thursday
    deadline = cooling_off_deadline_utc(approved)
    # End of Tuesday 18 Aug 2026 Israel time → UTC same calendar day evening.
    assert deadline.date() == date(2026, 8, 18)
    assert israel_business_days_remaining(deadline, now=approved) == 3
    last_day = datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc)
    assert israel_business_days_remaining(deadline, now=last_day) == 1
    too_late = datetime(2026, 8, 19, 0, 0, tzinfo=timezone.utc)
    assert israel_business_days_remaining(deadline, now=too_late) == 0
