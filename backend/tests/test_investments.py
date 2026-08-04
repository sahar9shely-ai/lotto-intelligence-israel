from datetime import date

from fastapi.testclient import TestClient

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import User
from app.security.auth import hash_password
from app.services import investment_service as inv_svc

client = TestClient(app)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _auth_headers(email: str = "sahar9shely@gmail.com", password: str = "Password1!") -> dict:
    # Backward-compatible helper: map known emails to usernames.
    _ensure_seeded()
    username_map = {
        "sahar9shely@gmail.com": "sahar",
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
    login = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_seed_and_dashboard():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers)
    assert investors.status_code == 200
    names = {i["name"] for i in investors.json()}
    assert {"סהר", "בר", "אופק", "אלמוג", "שושי"} <= names or {
        "מנהלת",
        "בר",
        "אופק",
        "אלמוג",
        "שושי",
    } <= names

    dashboard = client.get("/api/v1/investments/dashboard", headers=headers)
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert "total_principal" in body
    assert "monthly_manager_fees" in body


def test_plan_payment_and_quote_flow():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    bar = next(i for i in investors if i["name"] == "בר")

    plan_res = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": bar["id"],
            "principal": 100000,
            "monthly_rate_percent": 2,
            "manager_fee_percent": 0.5,
            "start_date": date.today().isoformat(),
            "duration_months": 12,
            "generate_schedule": True,
        },
    )
    assert plan_res.status_code == 201
    plan = plan_res.json()
    assert plan["monthly_investor_payout"] == 2000
    assert plan["monthly_manager_fee"] == 500

    payments = client.get(
        f"/api/v1/investments/payments?plan_id={plan['id']}", headers=headers
    ).json()
    assert len(payments) == 12

    paid = client.patch(
        f"/api/v1/investments/payments/{payments[0]['id']}",
        headers=headers,
        json={"status": "paid"},
    )
    assert paid.status_code == 200

    quote = client.post(
        "/api/v1/investments/quotes",
        headers=headers,
        json={
            "prospect_name": "נועה",
            "principal": 50000,
            "monthly_rate_percent": 1.5,
            "manager_fee_percent": 0.4,
            "duration_months": 12,
        },
    )
    assert quote.status_code == 201
    quote_body = quote.json()

    converted = client.post(
        f"/api/v1/investments/quotes/{quote_body['id']}/convert",
        headers=headers,
        json={
            "start_date": date.today().isoformat(),
            "username": "noa",
            "password": "NoaPass12!",
        },
    )
    assert converted.status_code == 200
    assert converted.json()["investor_name"] == "נועה"


def test_settings_update():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    res = client.patch(
        "/api/v1/investments/settings",
        headers=headers,
        json={
            "default_monthly_rate_percent": 2.5,
            "default_manager_fee_percent": 0.75,
            "default_duration_months": 14,
            "manager_display_name": "סהר",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["default_duration_months"] == 14


def test_align_calendar_year_moves_midyear_plans():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    ofek = next(i for i in investors if i["name"] == "אופק")
    year = date.today().year
    plan_res = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": ofek["id"],
            "principal": 20000,
            "monthly_rate_percent": 2,
            "manager_fee_percent": 1,
            "start_date": f"{year}-08-04",
            "duration_months": 12,
            "generate_schedule": True,
        },
    )
    assert plan_res.status_code == 201
    plan_id = plan_res.json()["id"]

    before = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}&year={year}", headers=headers
    ).json()
    assert before
    assert before[0]["due_date"].startswith(f"{year}-08")

    aligned = client.post(
        f"/api/v1/investments/align-calendar-year?year={year}", headers=headers
    )
    assert aligned.status_code == 200
    assert aligned.json()["count"] >= 1

    plans = client.get("/api/v1/investments/plans", headers=headers).json()
    plan = next(p for p in plans if p["id"] == plan_id)
    assert plan["start_date"] == f"{year}-01-01"

    year_payments = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}&year={year}", headers=headers
    ).json()
    assert year_payments[0]["due_date"] == f"{year}-01-01"
    assert year_payments[-1]["due_date"].startswith(f"{year}-12")


def test_open_calendar_year_and_payment_report():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    report_year = 2025

    opened = client.post(
        f"/api/v1/investments/open-calendar-year?year={report_year}", headers=headers
    )
    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert body["created_count"] >= 1

    payments = client.get(
        f"/api/v1/investments/payments?year={report_year}", headers=headers
    ).json()
    assert len(payments) >= 12
    assert payments[0]["due_date"].startswith("2025-01")

    report = client.get(
        f"/api/v1/investments/payment-report?year={report_year}", headers=headers
    )
    assert report.status_code == 200
    summary = report.json()
    assert summary["year"] == report_year
    assert summary["yearly"]["total_count"] >= 12
    assert summary["lifetime"]["total_count"] >= summary["yearly"]["total_count"]
    assert report_year in summary["available_years"]

    marked = client.post(
        f"/api/v1/investments/payments/mark-year-paid?year={report_year}",
        headers=headers,
    )
    assert marked.status_code == 200
    assert marked.json()["marked_count"] >= 1

    after = client.get(
        f"/api/v1/investments/payment-report?year={report_year}", headers=headers
    ).json()
    assert after["yearly"]["paid_count"] >= 1
    assert after["lifetime"]["paid_investor"] >= after["yearly"]["paid_investor"]

    # Opening again should not duplicate plans.
    again = client.post(
        f"/api/v1/investments/open-calendar-year?year={report_year}", headers=headers
    ).json()
    assert again["created_count"] == 0
