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
            "phone": "050-1234567",
            "principal": 50000,
            "monthly_rate_percent": 1.5,
            "manager_fee_percent": 0.4,
            "duration_months": 12,
        },
    )
    assert quote.status_code == 201
    quote_body = quote.json()
    assert quote_body["phone"] == "050-1234567"

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
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    noa = next(i for i in investors if i["name"] == "נועה")
    assert noa["phone"] == "050-1234567"


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
    body = marked.json()
    assert body["marked_count"] >= 1
    assert body["awaiting_count"] + body["auto_paid_count"] == body["marked_count"]

    after = client.get(
        f"/api/v1/investments/payment-report?year={report_year}", headers=headers
    ).json()
    assert after["yearly"]["awaiting_count"] + after["yearly"]["paid_count"] >= 1
    assert after["lifetime"]["paid_investor"] >= after["yearly"]["paid_investor"]

    # Opening again should not duplicate plans.
    again = client.post(
        f"/api/v1/investments/open-calendar-year?year={report_year}", headers=headers
    ).json()
    assert again["created_count"] == 0


def test_delete_plan_and_remove_from_year():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    bar = next(i for i in investors if i["name"] == "בר")
    year = 2024

    opened = client.post(
        f"/api/v1/investments/open-calendar-year?year={year}", headers=headers
    )
    assert opened.status_code == 200
    assert opened.json()["created_count"] >= 1

    before = client.get(
        f"/api/v1/investments/payments?year={year}&investor_id={bar['id']}",
        headers=headers,
    ).json()
    assert len(before) == 12

    removed = client.post(
        f"/api/v1/investments/remove-from-calendar-year?year={year}&investor_id={bar['id']}",
        headers=headers,
    )
    assert removed.status_code == 200
    assert removed.json()["deleted_count"] >= 1

    after = client.get(
        f"/api/v1/investments/payments?year={year}&investor_id={bar['id']}",
        headers=headers,
    ).json()
    assert after == []

    # Remaining investors still in year; delete one plan by id
    leftover = client.get(
        f"/api/v1/investments/payments?year={year}", headers=headers
    ).json()
    assert leftover
    plan_id = leftover[0]["plan_id"]
    deleted = client.delete(f"/api/v1/investments/plans/{plan_id}", headers=headers)
    assert deleted.status_code == 204
    gone = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}", headers=headers
    ).json()
    assert gone == []


def test_payment_requires_investor_confirmation():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    bar = next(i for i in investors if i["name"] == "בר")
    year = 2031  # isolated future year — avoids colliding with live schedules

    plan_res = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": bar["id"],
            "principal": 12000,
            "monthly_rate_percent": 2,
            "manager_fee_percent": 0,
            "start_date": f"{year}-01-01",
            "duration_months": 12,
            "generate_schedule": True,
            "notes": "בדיקת אישור תשלום",
        },
    )
    assert plan_res.status_code == 201
    plan_id = plan_res.json()["id"]
    payments = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}", headers=headers
    ).json()
    assert len(payments) == 12
    payment_id = payments[0]["id"]

    marked = client.patch(
        f"/api/v1/investments/payments/{payment_id}",
        headers=headers,
        json={"status": "paid"},
    )
    assert marked.status_code == 200
    assert marked.json()["status"] == "awaiting_confirmation"
    assert marked.json()["paid_at"] is None

    # Investor cannot mark via manager endpoint; must confirm.
    bar_headers = _auth_headers("bar050297@gmail.com", "InvestorPass1!")
    forbidden = client.patch(
        f"/api/v1/investments/payments/{payment_id}",
        headers=bar_headers,
        json={"status": "paid"},
    )
    assert forbidden.status_code == 403

    confirmed = client.post(
        f"/api/v1/investments/payments/{payment_id}/confirm",
        headers=bar_headers,
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "paid"
    assert confirmed.json()["paid_at"] is not None

    client.delete(f"/api/v1/investments/plans/{plan_id}", headers=headers)


def test_regenerate_after_start_change_does_not_duplicate_due_dates():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    bar = next(i for i in investors if i["name"] == "בר")
    year = 2032

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
            "notes": "בדיקת כפילות",
        },
    )
    assert plan_res.status_code == 201
    plan_id = plan_res.json()["id"]

    payments = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}", headers=headers
    ).json()
    assert len(payments) == 12
    september = next(p for p in payments if p["due_date"].endswith("-09-01"))
    paid = client.patch(
        f"/api/v1/investments/payments/{september['id']}",
        headers=headers,
        json={"status": "paid"},
    )
    assert paid.status_code == 200

    updated = client.patch(
        f"/api/v1/investments/plans/{plan_id}",
        headers=headers,
        json={
            "start_date": f"{year}-09-01",
            "regenerate_schedule": True,
        },
    )
    assert updated.status_code == 200

    after = client.get(
        f"/api/v1/investments/payments?plan_id={plan_id}", headers=headers
    ).json()
    due_dates = [p["due_date"] for p in after]
    assert len(due_dates) == len(set(due_dates)), due_dates
    assert len(after) == 12

    client.delete(f"/api/v1/investments/plans/{plan_id}", headers=headers)


def test_no_duplicate_investor_due_dates_across_plans():
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    bar = next(i for i in investors if i["name"] == "בר")
    year = 2033

    first = client.post(
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
            "notes": "מסלול ראשון לבדיקת כפל",
        },
    )
    assert first.status_code == 201
    first_id = first.json()["id"]

    second = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": bar["id"],
            "principal": 20000,
            "monthly_rate_percent": 2,
            "manager_fee_percent": 0,
            "start_date": f"{year}-01-01",
            "duration_months": 12,
            "generate_schedule": True,
            "notes": "מסלול שני חופף — לא אמור ליצור כפל",
        },
    )
    assert second.status_code == 201
    second_id = second.json()["id"]

    payments = client.get(
        f"/api/v1/investments/payments?year={year}&investor_id={bar['id']}",
        headers=headers,
    ).json()
    due_dates = [p["due_date"] for p in payments]
    assert len(due_dates) == len(set(due_dates)), due_dates
    assert len(due_dates) == 12

    client.delete(f"/api/v1/investments/plans/{first_id}", headers=headers)
    client.delete(f"/api/v1/investments/plans/{second_id}", headers=headers)


def test_hybrid_and_savings_plan_types_available_without_seeding():
    """Track types exist for quotes/plans; seed does not assign them to anyone."""
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")

    # Existing seeded investors should not suddenly get savings/hybrid plans.
    plans = client.get("/api/v1/investments/plans", headers=headers).json()
    for plan in plans:
        assert plan.get("plan_type", "monthly") in {"monthly", "savings", "hybrid"}

    quote = client.post(
        "/api/v1/investments/quotes",
        headers=headers,
        json={
            "prospect_name": "בדיקת משולב",
            "principal": 100000,
            "plan_type": "hybrid",
            "monthly_rate_percent": 1,
            "savings_rate_percent": 1,
            "manager_fee_percent": 0.5,
            "duration_months": 12,
        },
    )
    assert quote.status_code == 201, quote.text
    body = quote.json()
    assert body["plan_type"] == "hybrid"
    assert body["monthly_investor_payout"] == 1000
    assert body["monthly_savings_accrual"] == 1000
    assert body["projected_savings_balance"] == 12000
    assert body["total_cash_payout"] == 12000
    assert body["total_investor_payout"] == 24000

    savings_quote = client.post(
        "/api/v1/investments/quotes",
        headers=headers,
        json={
            "prospect_name": "בדיקת חיסכון",
            "principal": 100000,
            "plan_type": "savings",
            "monthly_rate_percent": 9,  # ignored for pure savings
            "savings_rate_percent": 2,
            "manager_fee_percent": 0.5,
            "duration_months": 24,
        },
    )
    assert savings_quote.status_code == 201, savings_quote.text
    s = savings_quote.json()
    assert s["plan_type"] == "savings"
    assert s["monthly_rate_percent"] == 0
    assert s["monthly_investor_payout"] == 0
    assert s["monthly_savings_accrual"] == 2000
    # Year1: 12*2000=24000 compounds; Year2 accrues on 124000 → 12*2480=29760; total 53760
    assert s["projected_savings_balance"] == 53760
    assert s["total_investor_payout"] == 53760

    # Convert hybrid quote → plan keeps type; do not attach to existing seeded people.
    converted = client.post(
        f"/api/v1/investments/quotes/{body['id']}/convert",
        headers=headers,
        json={
            "start_date": date.today().isoformat(),
            "username": "hybriddemo",
            "password": "HybridPass1!",
        },
    )
    assert converted.status_code == 200, converted.text
    plan = converted.json()
    assert plan["plan_type"] == "hybrid"
    assert plan["monthly_investor_payout"] == 1000
    assert plan["projected_savings_balance"] == 12000

    payments = client.get(
        f"/api/v1/investments/payments?plan_id={plan['id']}", headers=headers
    ).json()
    assert len(payments) == 12
    assert all(p["investor_amount"] == 1000 for p in payments)

    # Cleanup quote leftover
    client.delete(f"/api/v1/investments/quotes/{savings_quote.json()['id']}", headers=headers)


def test_reporting_board_savings_do_not_overlap_next_year():
    """Mid-year לוח דיווח must not accrue savings into the next active plan."""
    from datetime import date as date_cls

    from app.db.investment_session import InvestmentSessionLocal
    from app.models.investments import Investor, InvestmentPlan, Payment
    from app.services import investment_service as svc

    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    # Create isolated investor via API
    created = client.post(
        "/api/v1/investments/investors",
        headers=headers,
        json={
            "name": "בדיקת כפילות חיסכון",
            "username": "dupsave",
            "password": "DupSave12!",
            "is_manager": False,
        },
    )
    assert created.status_code == 201, created.text
    inv_id = created.json()["id"]

    db = InvestmentSessionLocal()
    try:
        # 2025 reporting board: Sep–Dec only (4 months), ~1100 savings/mo on 30k@3.6667
        board = InvestmentPlan(
            investor_id=inv_id,
            principal=30000,
            plan_type="hybrid",
            monthly_rate_percent=8.3333,
            savings_rate_percent=3.6667,
            manager_fee_percent=0,
            start_date=date_cls(2025, 9, 1),
            duration_months=12,  # buggy stored duration — must be clipped by effective logic
            status="completed",
            notes="לוח דיווח לשנת 2025",
        )
        db.add(board)
        db.flush()
        for i, due in enumerate(
            [
                date_cls(2025, 9, 1),
                date_cls(2025, 10, 1),
                date_cls(2025, 11, 1),
                date_cls(2025, 12, 1),
            ],
            start=1,
        ):
            db.add(
                Payment(
                    plan_id=board.id,
                    investor_id=inv_id,
                    month_number=i,
                    due_date=due,
                    investor_amount=2499.99,
                    manager_amount=0,
                    status="paid",
                    paid_at=date_cls(2025, 12, 31),
                )
            )
        # 2026 active plan: also ~1100 savings/mo
        active = InvestmentPlan(
            investor_id=inv_id,
            principal=43000,
            plan_type="hybrid",
            monthly_rate_percent=8.8372,
            savings_rate_percent=2.5581,
            manager_fee_percent=0,
            start_date=date_cls(2026, 1, 1),
            duration_months=12,
            status="active",
            notes="מסלול 2026",
        )
        db.add(active)
        db.commit()
        db.refresh(board)
        db.refresh(active)
        board = (
            db.query(InvestmentPlan)
            .filter(InvestmentPlan.id == board.id)
            .one()
        )
        # Attach payments for effective duration
        board = (
            db.query(InvestmentPlan)
            .options(__import__("sqlalchemy.orm", fromlist=["joinedload"]).joinedload(InvestmentPlan.payments))
            .filter(InvestmentPlan.id == board.id)
            .one()
        )
        active = (
            db.query(InvestmentPlan)
            .options(__import__("sqlalchemy.orm", fromlist=["joinedload"]).joinedload(InvestmentPlan.payments))
            .filter(InvestmentPlan.id == active.id)
            .one()
        )

        today = date_cls(2026, 8, 7)
        assert svc.plan_effective_duration(board) == 4
        m_board = svc.plan_metrics(board, today)
        m_active = svc.plan_metrics(active, today)
        assert m_board["months_elapsed"] == 4
        assert abs(m_board["current_savings_balance"] - 4400.04) < 0.05
        assert m_active["months_elapsed"] == 8
        assert abs(m_active["current_savings_balance"] - 8799.84) < 0.05

        investor = (
            db.query(Investor)
            .options(
                __import__("sqlalchemy.orm", fromlist=["joinedload"]).joinedload(Investor.plans).joinedload(
                    InvestmentPlan.payments
                )
            )
            .filter(Investor.id == inv_id)
            .one()
        )
        summary = svc.serialize_investor(investor, today)
        # Monthly line is active-only (no double 1100)
        assert abs(summary["monthly_savings"] - 1099.98) < 0.05
        # Lifetime = 4×1100 + 8×1100
        assert abs(summary["current_savings_balance"] - 13199.88) < 0.1

        clipped = svc.clip_reporting_year_plan_spans(db)
        assert clipped["clipped"] >= 1
        db.refresh(board)
        assert board.duration_months == 4
    finally:
        db.close()


def test_withdraw_and_transfer_savings_to_principal():
    """Withdraw shrinks pot; transfer boosts קרן without changing accrual base."""
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")

    create_inv = client.post(
        "/api/v1/investments/investors",
        headers=headers,
        json={
            "name": "בדיקת משיכת חיסכון",
            "username": "savingsredeem",
            "password": "Password1!",
        },
    )
    assert create_inv.status_code == 201, create_inv.text
    inv_id = create_inv.json()["id"]

    # 100k @ 1% savings, started 6 months ago → ~6k accrued
    start = date.today().replace(day=1)
    # go back 5 months so months_elapsed_inclusive ≈ 6
    month = start.month - 5
    year = start.year
    while month <= 0:
        month += 12
        year -= 1
    start = start.replace(year=year, month=month)

    create_plan = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": inv_id,
            "principal": 100000,
            "plan_type": "hybrid",
            "monthly_rate_percent": 1,
            "savings_rate_percent": 1,
            "manager_fee_percent": 0.5,
            "start_date": start.isoformat(),
            "duration_months": 12,
            "generate_schedule": True,
        },
    )
    assert create_plan.status_code == 201, create_plan.text
    plan = create_plan.json()
    plan_id = plan["id"]
    available_before = float(plan["current_savings_balance"])
    assert available_before >= 5000, plan
    accrual_before = float(plan.get("accrual_principal") or plan["principal"])
    assert accrual_before == 100000

    # Partial withdraw
    withdraw = client.post(
        f"/api/v1/investments/plans/{plan_id}/savings/withdraw",
        headers=headers,
        json={"amount": 1000},
    )
    assert withdraw.status_code == 200, withdraw.text
    w = withdraw.json()
    assert w["action"]["action_type"] == "withdraw"
    assert abs(w["action"]["amount"] - 1000) < 0.01
    assert abs(w["plan"]["principal"] - 100000) < 0.01
    assert abs(w["plan"]["current_savings_balance"] - (available_before - 1000)) < 0.05
    assert abs(float(w["plan"]["accrual_principal"]) - 100000) < 0.01

    after_withdraw = float(w["plan"]["current_savings_balance"])

    # Transfer rest of a chunk into קרן
    transfer_amt = 2000
    transfer = client.post(
        f"/api/v1/investments/plans/{plan_id}/savings/transfer-to-principal",
        headers=headers,
        json={"amount": transfer_amt},
    )
    assert transfer.status_code == 200, transfer.text
    t = transfer.json()
    assert t["action"]["action_type"] == "transfer_to_principal"
    assert abs(t["plan"]["principal"] - 102000) < 0.01
    assert abs(float(t["plan"]["accrual_principal"]) - 100000) < 0.01
    assert abs(t["plan"]["current_savings_balance"] - (after_withdraw - transfer_amt)) < 0.05
    # Cash payout should rise with new principal (1% of 102k)
    assert abs(t["plan"]["monthly_investor_payout"] - 1020) < 0.01
    # Monthly savings accrual stays on accrual principal (1% of 100k)
    assert abs(t["plan"]["monthly_savings_accrual"] - 1000) < 0.01

    # Cannot withdraw more than available
    too_much = client.post(
        f"/api/v1/investments/plans/{plan_id}/savings/withdraw",
        headers=headers,
        json={"amount": 999999},
    )
    assert too_much.status_code == 400

    # Investor must not withdraw / transfer — manager only
    inv_headers = _auth_headers("savingsredeem", "Password1!")
    # _auth_headers maps email→username; pass username via email-like fallback
    forbidden_w = client.post(
        f"/api/v1/investments/plans/{plan_id}/savings/withdraw",
        headers=inv_headers,
        json={"amount": 100},
    )
    assert forbidden_w.status_code == 403, forbidden_w.text
    forbidden_t = client.post(
        f"/api/v1/investments/plans/{plan_id}/savings/transfer-to-principal",
        headers=inv_headers,
        json={"amount": 100},
    )
    assert forbidden_t.status_code == 403, forbidden_t.text

    client.delete(f"/api/v1/investments/plans/{plan_id}", headers=headers)


def test_settle_savings_continue_and_close():
    """Questionnaire: continue opens successor; close marks completed."""
    headers = _auth_headers("sahar9shely@gmail.com", "ManagerPass1!")

    create_inv = client.post(
        "/api/v1/investments/investors",
        headers=headers,
        json={
            "name": "בדיקת סגירה",
            "username": "settleclose",
            "password": "Password1!",
        },
    )
    assert create_inv.status_code == 201, create_inv.text
    inv_id = create_inv.json()["id"]

    start = date.today().replace(day=1)
    month = start.month - 5
    year = start.year
    while month <= 0:
        month += 12
        year -= 1
    start = start.replace(year=year, month=month)

    create_plan = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": inv_id,
            "principal": 100000,
            "plan_type": "hybrid",
            "monthly_rate_percent": 1,
            "savings_rate_percent": 1,
            "manager_fee_percent": 0.5,
            "start_date": start.isoformat(),
            "duration_months": 12,
            "generate_schedule": True,
        },
    )
    assert create_plan.status_code == 201, create_plan.text
    plan_id = create_plan.json()["id"]
    available = float(create_plan.json()["current_savings_balance"])
    assert available >= 1000

    # Continue with new compound track after partial transfer
    settle = client.post(
        f"/api/v1/investments/plans/{plan_id}/savings/settle",
        headers=headers,
        json={
            "action_type": "transfer_to_principal",
            "amount": 1000,
            "outcome": "continue_new_track",
            "compound_savings": True,
            "include_monthly_cash": True,
            "monthly_rate_percent": 1.2,
            "savings_rate_percent": 1.1,
            "manager_fee_percent": 0.5,
            "new_duration_months": 12,
            "new_start_date": date.today().replace(day=1).isoformat(),
        },
    )
    assert settle.status_code == 200, settle.text
    body = settle.json()
    assert body["outcome"] == "continue_new_track"
    assert body["closed_plan"]["status"] == "completed"
    assert body["closed_plan"]["successor_plan_id"] == body["new_plan"]["id"]
    assert body["new_plan"]["status"] == "active"
    assert body["new_plan"]["plan_type"] == "hybrid"
    assert abs(body["new_plan"]["monthly_rate_percent"] - 1.2) < 0.001
    assert abs(body["new_plan"]["savings_rate_percent"] - 1.1) < 0.001
    # Leftover savings rolled into קרן: principal ≈ 100000 + available
    assert abs(body["new_plan"]["principal"] - (100000 + available)) < 0.05

    new_id = body["new_plan"]["id"]

    # Seed a bit of savings on the new plan by backdating... can't easily.
    # Create another plan to test close_plan path.
    create_plan2 = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": inv_id,
            "principal": 50000,
            "plan_type": "savings",
            "monthly_rate_percent": 0,
            "savings_rate_percent": 2,
            "manager_fee_percent": 0,
            "start_date": start.isoformat(),
            "duration_months": 12,
            "generate_schedule": True,
        },
    )
    assert create_plan2.status_code == 201, create_plan2.text
    plan2 = create_plan2.json()
    plan2_id = plan2["id"]
    avail2 = float(plan2["current_savings_balance"])
    assert avail2 > 0

    close = client.post(
        f"/api/v1/investments/plans/{plan2_id}/savings/settle",
        headers=headers,
        json={
            "action_type": "withdraw",
            "amount": min(500, avail2),
            "outcome": "close_plan",
            "withdraw_remaining": True,
        },
    )
    assert close.status_code == 200, close.text
    closed = close.json()
    assert closed["outcome"] == "close_plan"
    assert closed["closed_plan"]["status"] == "completed"
    assert closed["new_plan"] is None
    assert float(closed["closed_plan"]["current_savings_balance"]) < 0.02

    client.delete(f"/api/v1/investments/plans/{plan_id}", headers=headers)
    client.delete(f"/api/v1/investments/plans/{new_id}", headers=headers)
    client.delete(f"/api/v1/investments/plans/{plan2_id}", headers=headers)
