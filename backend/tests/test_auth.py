import json

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import EmailOutbox, User
from app.security.auth import hash_password
from app.services import auth_service as auth_svc
from app.services import investment_service as inv_svc

client = TestClient(app)


def _ensure_seeded() -> None:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def _latest_token_for(email: str) -> str:
    db: Session = InvestmentSessionLocal()
    try:
        mail = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.to_email == email)
            .order_by(EmailOutbox.id.desc())
            .first()
        )
        assert mail is not None, f"no email for {email}"
        assert mail.meta_json
        return json.loads(mail.meta_json)["token"]
    finally:
        db.close()


def _set_password(email: str, password: str = "Password1!") -> None:
    client.post("/api/v1/auth/forgot-password", json={"email": email})
    token = _latest_token_for(email)
    res = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": password},
    )
    assert res.status_code == 200, res.text


def test_auth_required_for_dashboard():
    res = client.get("/api/v1/investments/dashboard")
    assert res.status_code == 401


def test_first_login_requires_email_reset_then_login_alerts_manager():
    _ensure_seeded()

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "bar050297@gmail.com", "password": "anything"},
    )
    assert blocked.status_code == 403

    _set_password("sahar9shely@gmail.com", "ManagerPass1!")
    _set_password("bar050297@gmail.com", "BarPass123!")

    bar_login = client.post(
        "/api/v1/auth/login",
        json={"email": "bar050297@gmail.com", "password": "BarPass123!"},
    )
    assert bar_login.status_code == 200
    bar_token = bar_login.json()["access_token"]

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
        json={"email": "sahar9shely@gmail.com", "password": "ManagerPass1!"},
    )
    assert manager_login.status_code == 200
    m_token = manager_login.json()["access_token"]

    alerts = client.get(
        "/api/v1/auth/login-alerts",
        headers={"Authorization": f"Bearer {m_token}"},
    )
    assert alerts.status_code == 200
    assert any(a["email"] == "bar050297@gmail.com" for a in alerts.json())


def test_forgot_password_flow():
    _ensure_seeded()
    db = InvestmentSessionLocal()
    try:
        user = db.query(User).filter(User.email == "ofek@tazrim.app").first()
        assert user is not None
        user.password_hash = hash_password("OldPass123!")
        user.must_reset_password = False
        db.commit()
    finally:
        db.close()

    forgot = client.post(
        "/api/v1/auth/forgot-password", json={"email": "ofek@tazrim.app"}
    )
    assert forgot.status_code == 200
    token = _latest_token_for("ofek@tazrim.app")
    reset = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "NewPass123!"},
    )
    assert reset.status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "ofek@tazrim.app", "password": "NewPass123!"},
    )
    assert login.status_code == 200
