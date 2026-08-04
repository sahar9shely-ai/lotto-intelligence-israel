import json
from datetime import date

from fastapi.testclient import TestClient

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import EmailOutbox
from app.services import investment_service as inv_svc

client = TestClient(app)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _auth_headers(email: str, password: str = "Password1!") -> dict:
    _ensure_seeded()
    client.post("/api/v1/auth/forgot-password", json={"email": email})
    db = InvestmentSessionLocal()
    try:
        mail = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.to_email == email)
            .order_by(EmailOutbox.id.desc())
            .first()
        )
        assert mail is not None, f"missing invite mail for {email}"
        token = json.loads(mail.meta_json)["token"]
    finally:
        db.close()
    reset = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": password},
    )
    assert reset.status_code == 200, reset.text
    login = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_seed_and_dashboard():
    headers = _auth_headers("manager@tazrim.app", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers)
    assert investors.status_code == 200
    names = {i["name"] for i in investors.json()}
    assert {"מנהלת", "בר", "אופק", "אלמוג", "שושי"} <= names or {
        "שחר",
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
    headers = _auth_headers("manager@tazrim.app", "ManagerPass1!")
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
        json={"start_date": date.today().isoformat()},
    )
    assert converted.status_code == 200
    assert converted.json()["investor_name"] == "נועה"


def test_settings_update():
    headers = _auth_headers("manager@tazrim.app", "ManagerPass1!")
    res = client.patch(
        "/api/v1/investments/settings",
        headers=headers,
        json={
            "default_monthly_rate_percent": 2.5,
            "default_manager_fee_percent": 0.75,
            "default_duration_months": 14,
            "manager_display_name": "שחר",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["default_duration_months"] == 14
    assert body["manager_display_name"] == "שחר"
