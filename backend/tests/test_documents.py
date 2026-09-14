from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import User
from app.models.investments import InvestmentTopupRequest
from app.security.auth import hash_password
from app.services import investment_service as inv_svc

client = TestClient(app)

TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _login(username: str, password: str) -> tuple[dict, int]:
    _ensure_seeded()
    db = InvestmentSessionLocal()
    try:
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


def _manager() -> tuple[dict, int]:
    return _login("admin", "ManagerPass1!")


def _bar() -> tuple[dict, int]:
    return _login("bar", "InvestorPass1!")


def _clear_open(investor_id: int) -> None:
    db = InvestmentSessionLocal()
    try:
        rows = (
            db.query(InvestmentTopupRequest)
            .filter(
                InvestmentTopupRequest.investor_id == investor_id,
                InvestmentTopupRequest.status.in_(("pending", "contract")),
            )
            .all()
        )
        for row in rows:
            row.status = "cancelled"
        db.commit()
    finally:
        db.close()


def _kinds(body: dict) -> set[str]:
    return {row["kind"] for row in body["documents"]}


def test_manager_must_choose_investor_for_vault():
    manager, _ = _manager()
    res = client.get("/api/v1/investments/documents", headers=manager)
    assert res.status_code == 400
    assert "משקיע" in res.json()["detail"]


def test_investor_cannot_open_another_vault():
    manager, _ = _manager()
    bar, bar_id = _bar()
    investors = client.get("/api/v1/investments/investors", headers=manager).json()
    other = next(i for i in investors if i["id"] != bar_id and i["name"] != "מנהל מערכת")
    blocked = client.get(
        f"/api/v1/investments/documents?investor_id={other['id']}",
        headers=bar,
    )
    assert blocked.status_code == 403


def test_vault_lists_signed_contract_quote_and_reports_per_investor():
    manager, _ = _manager()
    bar, bar_id = _bar()
    _clear_open(bar_id)

    uname = f"vn{uuid4().hex[:8]}"
    quote = client.post(
        "/api/v1/investments/quotes",
        headers=manager,
        json={
            "prospect_name": "נויה כספת",
            "phone": "050-7001122",
            "principal": 40000,
            "monthly_rate_percent": 1.5,
            "manager_fee_percent": 0.6,
            "duration_months": 12,
            "access_username": uname,
            "access_password": "VaultNoya1!",
        },
    )
    assert quote.status_code == 201, quote.text
    quote_id = quote.json()["id"]
    approved = client.patch(
        f"/api/v1/investments/quotes/{quote_id}",
        headers=manager,
        json={"status": "approved"},
    )
    assert approved.status_code == 200, approved.text
    converted = client.post(
        f"/api/v1/investments/quotes/{quote_id}/convert",
        headers=manager,
        json={"start_date": date.today().isoformat()},
    )
    assert converted.status_code == 200, converted.text

    noya, noya_id = _login(uname, "VaultNoya1!")
    own = client.get("/api/v1/investments/documents", headers=noya)
    assert own.status_code == 200, own.text
    body = own.json()
    assert body["investor_id"] == noya_id
    assert body["investor_name"] == "נויה כספת"
    kinds = _kinds(body)
    assert "quote" in kinds
    assert "yearly" in kinds
    assert "monthly" in kinds
    quote_row = next(row for row in body["documents"] if row["kind"] == "quote")
    assert quote_row["source_id"] == quote_id
    assert "40,000" in (quote_row["subtitle"] or "")

    as_manager = client.get(
        f"/api/v1/investments/documents?investor_id={noya_id}",
        headers=manager,
    )
    assert as_manager.status_code == 200
    assert {row["id"] for row in as_manager.json()["documents"]} == {
        row["id"] for row in body["documents"]
    }

    bar_vault = client.get("/api/v1/investments/documents", headers=bar).json()
    assert all(row["source_id"] != quote_id for row in bar_vault["documents"] if row["kind"] == "quote")

    fetched = client.get(f"/api/v1/investments/quotes/{quote_id}", headers=noya)
    assert fetched.status_code == 200, fetched.text
    offer = fetched.json()
    assert offer["access_password"] is None
    assert offer["manager_fee_percent"] == 0
    assert offer["monthly_manager_fee"] == 0

    foreign = client.get(f"/api/v1/investments/quotes/{quote_id}", headers=bar)
    assert foreign.status_code == 403

    unsigned = client.post(
        "/api/v1/investments/investment-requests",
        headers=bar,
        json={"amount": 18000, "notes": "טיוטה לכספת"},
    )
    assert unsigned.status_code == 201, unsigned.text
    offered = client.post(
        f"/api/v1/investments/investment-requests/{unsigned.json()['id']}/approve",
        headers=manager,
        json={
            "plan_type": "monthly",
            "monthly_rate_percent": 1.2,
            "savings_rate_percent": 0,
            "manager_fee_percent": 0.5,
            "start_date": "2042-01-01",
            "duration_months": 12,
        },
    )
    assert offered.status_code == 200, offered.text
    after_offer = client.get("/api/v1/investments/documents", headers=bar).json()
    assert all(row["source_id"] != unsigned.json()["id"] for row in after_offer["documents"] if row["kind"] == "contract")

    signed = client.post(
        f"/api/v1/investments/investment-requests/{unsigned.json()['id']}/sign",
        headers=manager,
        json={"typed_name": "סהר מנהל", "signature_png": TINY_PNG, "accepted_terms": True},
    )
    assert signed.status_code == 200, signed.text
    done = client.post(
        f"/api/v1/investments/investment-requests/{unsigned.json()['id']}/sign",
        headers=bar,
        json={"typed_name": "בר משקיע", "signature_png": TINY_PNG, "accepted_terms": True},
    )
    assert done.status_code == 200, done.text
    assert done.json()["both_signed"] is True

    bar_after = client.get("/api/v1/investments/documents", headers=bar).json()
    contract_ids = [
        row["source_id"] for row in bar_after["documents"] if row["kind"] == "contract"
    ]
    assert unsigned.json()["id"] in contract_ids

    noya_after = client.get("/api/v1/investments/documents", headers=noya).json()
    assert all(
        row["source_id"] != unsigned.json()["id"]
        for row in noya_after["documents"]
        if row["kind"] == "contract"
    )
