from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import PasswordResetRequest, User
from app.security.auth import hash_password
from app.services import investment_service as inv_svc

client = TestClient(app)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _set_password(username: str, password: str = "Password1!") -> None:
    db: Session = InvestmentSessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None, f"missing user {username}"
        user.password_hash = hash_password(password)
        user.must_reset_password = False
        db.commit()
    finally:
        db.close()


def _auth_headers(username: str, password: str = "Password1!") -> dict:
    _ensure_seeded()
    _set_password(username, password)
    login = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_auth_required_for_dashboard():
    res = client.get("/api/v1/investments/dashboard")
    assert res.status_code == 401


def test_username_login_and_investor_scope_alerts_manager():
    _ensure_seeded()

    blocked = client.post(
        "/api/v1/auth/login",
        json={"username": "bar", "password": "anything"},
    )
    assert blocked.status_code == 403

    _set_password("sahar", "ManagerPass1!")
    _set_password("bar", "BarPass123!")

    bar_login = client.post(
        "/api/v1/auth/login",
        json={"username": "bar", "password": "BarPass123!"},
    )
    assert bar_login.status_code == 200
    bar_token = bar_login.json()["access_token"]
    assert bar_login.json()["user"]["username"] == "bar"

    dash = client.get(
        "/api/v1/investments/dashboard",
        headers={"Authorization": f"Bearer {bar_token}"},
    )
    assert dash.status_code == 200
    names = {i["name"] for i in dash.json()["investors_summary"]}
    assert names == {"בר"}

    quotes = client.get(
        "/api/v1/investments/quotes",
        headers={"Authorization": f"Bearer {bar_token}"},
    )
    assert quotes.status_code == 403

    manager_login = client.post(
        "/api/v1/auth/login",
        json={"username": "sahar", "password": "ManagerPass1!"},
    )
    assert manager_login.status_code == 200
    m_token = manager_login.json()["access_token"]

    alerts = client.get(
        "/api/v1/auth/login-alerts",
        headers={"Authorization": f"Bearer {m_token}"},
    )
    assert alerts.status_code == 200
    assert any(a["display_name"] == "בר" for a in alerts.json())


def test_password_reset_requires_manager_approval():
    _ensure_seeded()
    _set_password("ofek", "OldPass123!")

    # Client cannot self-reset — only opens a request.
    req = client.post(
        "/api/v1/auth/request-password-reset",
        json={"username": "ofek", "note": "שכחתי"},
    )
    assert req.status_code == 200

    # Old password still works until manager fulfills.
    still = client.post(
        "/api/v1/auth/login",
        json={"username": "ofek", "password": "OldPass123!"},
    )
    assert still.status_code == 200

    headers = _auth_headers("sahar", "ManagerPass1!")
    pending = client.get(
        "/api/v1/auth/password-reset-requests?pending_only=true",
        headers=headers,
    )
    assert pending.status_code == 200
    items = pending.json()
    assert any(i["username"] == "ofek" for i in items)
    request_id = next(i["id"] for i in items if i["username"] == "ofek")

    fulfilled = client.post(
        f"/api/v1/auth/password-reset-requests/{request_id}/fulfill",
        headers=headers,
        json={"new_password": "NewPass999!"},
    )
    assert fulfilled.status_code == 200
    assert fulfilled.json()["status"] == "fulfilled"

    old = client.post(
        "/api/v1/auth/login",
        json={"username": "ofek", "password": "OldPass123!"},
    )
    assert old.status_code == 401

    new = client.post(
        "/api/v1/auth/login",
        json={"username": "ofek", "password": "NewPass999!"},
    )
    assert new.status_code == 200


def test_manager_can_set_password_directly():
    headers = _auth_headers("sahar", "ManagerPass1!")
    users = client.get("/api/v1/auth/users", headers=headers).json()
    almog = next(u for u in users if u["username"] == "almog")
    res = client.post(
        f"/api/v1/auth/users/{almog['id']}/password",
        headers=headers,
        json={"new_password": "AlmogPass1!"},
    )
    assert res.status_code == 200
    assert res.json()["has_password"] is True
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "almog", "password": "AlmogPass1!"},
    )
    assert login.status_code == 200
