from datetime import date

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_seed_and_dashboard():
    seed = client.post("/api/v1/investments/seed")
    assert seed.status_code == 200

    investors = client.get("/api/v1/investments/investors")
    assert investors.status_code == 200
    names = {i["name"] for i in investors.json()}
    assert {"מנהלת", "בר", "אופק", "אלמוג", "שושי"} <= names or {
        "שחר",
        "בר",
        "אופק",
        "אלמוג",
        "שושי",
    } <= names

    dashboard = client.get("/api/v1/investments/dashboard")
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert "total_principal" in body
    assert "monthly_manager_fees" in body


def test_plan_payment_and_quote_flow():
    investors = client.get("/api/v1/investments/investors").json()
    bar = next(i for i in investors if i["name"] == "בר")

    plan_res = client.post(
        "/api/v1/investments/plans",
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
    assert plan["total_investor_payout"] == 24000

    payments = client.get(f"/api/v1/investments/payments?plan_id={plan['id']}").json()
    assert len(payments) == 12

    paid = client.patch(
        f"/api/v1/investments/payments/{payments[0]['id']}",
        json={"status": "paid"},
    )
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid"

    quote = client.post(
        "/api/v1/investments/quotes",
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
    assert quote_body["monthly_investor_payout"] == 750
    assert quote_body["annual_investor_payout"] == 9000

    converted = client.post(
        f"/api/v1/investments/quotes/{quote_body['id']}/convert",
        json={"start_date": date.today().isoformat()},
    )
    assert converted.status_code == 200
    assert converted.json()["investor_name"] == "נועה"


def test_settings_update():
    res = client.patch(
        "/api/v1/investments/settings",
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
