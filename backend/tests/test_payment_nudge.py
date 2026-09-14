from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import User
from app.models.investments import Payment
from app.security.auth import hash_password
from app.services import investment_service as inv_svc
from app.services.israel_business_days import (
    confirmation_nudge_due,
    israel_business_days_elapsed,
    is_israel_business_day,
)

client = TestClient(app)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _auth_headers(email: str, password: str) -> dict:
    _ensure_seeded()
    username_map = {
        "sahar9shely@gmail.com": "admin",
        "bar050297@gmail.com": "bar",
    }
    username = username_map.get(email, email.split("@")[0].lower())
    db = InvestmentSessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None, username
        user.password_hash = hash_password(password)
        user.must_reset_password = False
        db.commit()
    finally:
        db.close()
    login = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_israel_business_days_skip_friday_saturday():
    monday = date(2026, 9, 7)
    assert is_israel_business_day(monday)
    assert not is_israel_business_day(date(2026, 9, 11))  # Friday
    assert not is_israel_business_day(date(2026, 9, 12))  # Saturday
    assert is_israel_business_day(date(2026, 9, 13))  # Sunday

    assert israel_business_days_elapsed(monday, monday) == 0
    assert israel_business_days_elapsed(monday, date(2026, 9, 8)) == 1  # Tue
    assert israel_business_days_elapsed(monday, date(2026, 9, 9)) == 2  # Wed
    assert israel_business_days_elapsed(monday, date(2026, 9, 10)) == 3  # Thu
    assert not confirmation_nudge_due(monday, today=date(2026, 9, 9))
    assert confirmation_nudge_due(monday, today=date(2026, 9, 10))

    friday = date(2026, 9, 11)
    assert israel_business_days_elapsed(friday, date(2026, 9, 12)) == 0
    assert israel_business_days_elapsed(friday, date(2026, 9, 13)) == 1  # Sun
    assert israel_business_days_elapsed(friday, date(2026, 9, 15)) == 3  # Tue
    assert confirmation_nudge_due(friday, today=date(2026, 9, 15))


def test_confirmation_nudge_lists_stale_awaiting_only():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    bar = next(i for i in investors if i["name"] == "בר")
    year = 2033
    plan_res = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": bar["id"],
            "principal": 10000,
            "monthly_rate_percent": 2,
            "manager_fee_percent": 0,
            "start_date": f"{year}-01-01",
            "duration_months": 12,
            "generate_schedule": True,
            "notes": "בדיקת נודניק",
        },
    )
    assert plan_res.status_code == 201, plan_res.text
    plan_id = plan_res.json()["id"]
    payments = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}", headers=headers
    ).json()
    payment_id = payments[0]["id"]

    marked = client.patch(
        f"/api/v1/investments/payments/{payment_id}",
        headers=headers,
        json={"status": "paid"},
    )
    assert marked.status_code == 200
    assert marked.json()["status"] == "awaiting_confirmation"
    assert marked.json()["confirmation_requested_at"] is not None

    fresh = client.get("/api/v1/investments/payments/confirmation-nudges", headers=headers)
    assert fresh.status_code == 200, fresh.text
    assert all(item["id"] != payment_id for item in fresh.json()["items"])

    db = InvestmentSessionLocal()
    try:
        row = db.query(Payment).filter(Payment.id == payment_id).one()
        row.confirmation_requested_at = datetime.now(timezone.utc) - timedelta(days=10)
        db.commit()
    finally:
        db.close()

    stale = client.get("/api/v1/investments/payments/confirmation-nudges", headers=headers)
    assert stale.status_code == 200, stale.text
    hit = next(item for item in stale.json()["items"] if item["id"] == payment_id)
    assert hit["investor_id"] == bar["id"]
    assert hit["href"].startswith("/payments?")
    assert "payment_id=" in hit["href"]
    assert hit["business_days_waiting"] >= 3
    assert stale.json()["calendar"] == "israel_sun_thu"

    bar_headers = _auth_headers("bar050297@gmail.com", "InvestorPass1!")
    mine = client.get("/api/v1/investments/payments/confirmation-nudges", headers=bar_headers)
    assert mine.status_code == 200
    assert any(item["id"] == payment_id for item in mine.json()["items"])

    confirmed = client.post(
        f"/api/v1/investments/payments/{payment_id}/confirm",
        headers=bar_headers,
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "paid"

    gone = client.get("/api/v1/investments/payments/confirmation-nudges", headers=headers)
    assert all(item["id"] != payment_id for item in gone.json()["items"])

    client.delete(f"/api/v1/investments/plans/{plan_id}", headers=headers)
