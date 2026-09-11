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

    # Ensure investor starts without a usable password (suite may have set one earlier).
    db: Session = InvestmentSessionLocal()
    try:
        bar_user = db.query(User).filter(User.username == "bar").first()
        assert bar_user is not None
        bar_user.password_hash = None
        bar_user.must_reset_password = True
        db.commit()
    finally:
        db.close()

    blocked = client.post(
        "/api/v1/auth/login",
        json={"username": "bar", "password": "anything"},
    )
    assert blocked.status_code == 403

    _set_password("admin", "ManagerPass1!")
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
        json={"username": "admin", "password": "ManagerPass1!"},
    )
    assert manager_login.status_code == 200
    m_token = manager_login.json()["access_token"]

    alerts = client.get(
        "/api/v1/auth/login-alerts",
        headers={"Authorization": f"Bearer {m_token}"},
    )
    assert alerts.status_code == 200
    assert any(a["display_name"] == "בר" for a in alerts.json())

    activity = client.get(
        "/api/v1/auth/activity",
        headers={"Authorization": f"Bearer {m_token}"},
    )
    assert activity.status_code == 200
    assert any(
        e["kind"] == "login" and e["investor_name"] == "בר" and e["is_unread"]
        for e in activity.json()
    )

    summary = client.get(
        "/api/v1/auth/activity/summary",
        headers={"Authorization": f"Bearer {m_token}"},
    )
    assert summary.status_code == 200
    body = summary.json()
    assert body["unread_login_count"] >= 1
    assert body["latest_login_id"] > 0
    assert body["latest_login"]["kind"] == "login"
    assert "login" in (body.get("unread_by_group") or {})

    login_only = client.get(
        "/api/v1/auth/activity?group=login",
        headers={"Authorization": f"Bearer {m_token}"},
    )
    assert login_only.status_code == 200
    assert login_only.json()
    assert all(e["kind"] == "login" for e in login_only.json())


def test_plan_create_writes_activity_event():
    headers = _auth_headers("admin", "ManagerPass1!")
    investors = client.get("/api/v1/investments/investors", headers=headers)
    assert investors.status_code == 200
    target = next((i for i in investors.json() if not i.get("is_manager")), None)
    assert target is not None

    created = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": target["id"],
            "principal": 12000,
            "plan_type": "monthly",
            "monthly_rate_percent": 1.5,
            "savings_rate_percent": 0,
            "manager_fee_percent": 20,
            "start_date": "2026-01-01",
            "duration_months": 6,
            "generate_schedule": True,
        },
    )
    assert created.status_code == 201, created.text

    activity = client.get(
        "/api/v1/auth/activity?group=plan",
        headers=headers,
    )
    assert activity.status_code == 200
    assert any(
        e["kind"] == "plan_created" and e["investor_id"] == target["id"]
        for e in activity.json()
    )


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

    headers = _auth_headers("admin", "ManagerPass1!")
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
    users = client.get("/api/v1/auth/users", headers=headers)
    assert users.status_code == 200
    ofek = next(u for u in users.json() if u["username"] == "ofek")
    assert ofek["access_password"] == "NewPass999!"


def test_manager_can_set_password_directly():
    headers = _auth_headers("admin", "ManagerPass1!")
    users = client.get("/api/v1/auth/users", headers=headers).json()
    almog = next(u for u in users if u["username"] == "almog")
    res = client.post(
        f"/api/v1/auth/users/{almog['id']}/password",
        headers=headers,
        json={"new_password": "AlmogPass1!"},
    )
    assert res.status_code == 200
    assert res.json()["has_password"] is True
    assert res.json()["access_password"] == "AlmogPass1!"
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "almog", "password": "AlmogPass1!"},
    )
    assert login.status_code == 200


def test_manager_can_update_user_phone():
    headers = _auth_headers("admin", "ManagerPass1!")
    users = client.get("/api/v1/auth/users", headers=headers).json()
    almog = next(u for u in users if u["username"] == "almog")
    res = client.patch(
        f"/api/v1/auth/users/{almog['id']}",
        headers=headers,
        json={"phone": "052-535-7071"},
    )
    assert res.status_code == 200
    assert res.json()["phone"] == "052-535-7071"


def test_delete_user_removes_investor_and_history():
    from datetime import date

    headers = _auth_headers("admin", "ManagerPass1!")
    created = client.post(
        "/api/v1/auth/users",
        headers=headers,
        json={
            "name": "למחיקה",
            "username": "todelete",
            "password": "DeleteMe1!",
            "role": "investor",
            "phone": "050-999-8888",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    user_id = body["id"]
    investor_id = body["investor_id"]

    plan = client.post(
        "/api/v1/investments/plans",
        headers=headers,
        json={
            "investor_id": investor_id,
            "principal": 5000,
            "monthly_rate_percent": 2,
            "manager_fee_percent": 0,
            "start_date": date.today().isoformat(),
            "duration_months": 12,
        },
    )
    assert plan.status_code == 201, plan.text

    deleted = client.delete(f"/api/v1/auth/users/{user_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text

    investors = client.get("/api/v1/investments/investors", headers=headers).json()
    assert all(i["id"] != investor_id for i in investors)

    payments = client.get(
        f"/api/v1/investments/payments?investor_id={investor_id}",
        headers=headers,
    )
    assert payments.status_code == 200
    assert payments.json() == []

    login = client.post(
        "/api/v1/auth/login",
        json={"username": "todelete", "password": "DeleteMe1!"},
    )
    assert login.status_code == 401


def test_cannot_delete_manager():
    headers = _auth_headers("admin", "ManagerPass1!")
    users = client.get("/api/v1/auth/users", headers=headers).json()
    admin = next(u for u in users if u["username"] == "admin")

    res = client.delete(f"/api/v1/auth/users/{admin['id']}", headers=headers)
    assert res.status_code == 400
    assert "מנהל" in res.json()["detail"] or "עצמך" in res.json()["detail"]


def test_cannot_delete_manager_or_self():
    headers = _auth_headers("admin", "ManagerPass1!")
    users = client.get("/api/v1/auth/users", headers=headers).json()
    admin = next(u for u in users if u["username"] == "admin")

    self_delete = client.delete(f"/api/v1/auth/users/{admin['id']}", headers=headers)
    assert self_delete.status_code == 400
    assert "עצמך" in self_delete.json()["detail"] or "מנהל" in self_delete.json()["detail"]


def test_seed_defaults_twice_does_not_crash():
    """Startup + re-seed must stay idempotent (Render deploy runs seed on every boot)."""
    _ensure_seeded()
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def test_deleted_demo_investor_not_resurrected_on_reseed():
    """Deleting בר must stay deleted after restart/seed (Render boot)."""
    from app.models.investments import Investor

    _ensure_seeded()
    headers = _auth_headers("admin", "ManagerPass1!")
    users = client.get("/api/v1/auth/users", headers=headers).json()
    bar_user = next((u for u in users if u["investor_name"] == "בר"), None)
    assert bar_user is not None, "seed should create בר once"

    deleted = client.delete(f"/api/v1/auth/users/{bar_user['id']}", headers=headers)
    assert deleted.status_code == 204, deleted.text

    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        inv_svc.seed_defaults(db)
        names = {i.name for i in db.query(Investor).all()}
        assert "בר" not in names
        assert db.query(User).filter(User.username == "bar").first() is None
    finally:
        db.close()

    users_after = client.get("/api/v1/auth/users", headers=headers).json()
    assert all(u["investor_name"] != "בר" for u in users_after)

    # Restore בר for other session-scoped tests that still expect the demo roster.
    db = InvestmentSessionLocal()
    try:
        from app.models.investments import Investor
        from app.services import auth_service as auth_svc

        if db.query(Investor).filter(Investor.name == "בר").first() is None:
            inv = Investor(name="בר", is_manager=False)
            db.add(inv)
            db.flush()
            auth_svc.ensure_user_for_investor(
                db, inv, username="bar", email="bar050297@gmail.com", password=None
            )
            db.commit()
    finally:
        db.close()


def test_dedupe_removes_empty_duplicate_investors():
    """Two empty «אופק» rows → one investor + one user after seed/dedupe."""
    from app.models.investments import Investor
    from app.services import auth_service as auth_svc

    _ensure_seeded()
    db = InvestmentSessionLocal()
    try:
        ofek = db.query(Investor).filter(Investor.name == "אופק").first()
        assert ofek is not None
        dup = Investor(name="אופק", is_manager=False, notes="כפילות ריקה")
        db.add(dup)
        db.flush()
        auth_svc.ensure_user_for_investor(db, dup, username="ofekdup", password=None)
        db.commit()

        result = auth_svc.dedupe_investors_and_users(db)
        assert any("אופק#" in x for x in result["removed_investors"])

        ofeks = db.query(Investor).filter(Investor.name == "אופק").all()
        assert len(ofeks) == 1
        users = db.query(User).filter(User.investor_id == ofeks[0].id).all()
        assert len(users) == 1
    finally:
        db.close()


def test_split_admin_and_personal_accounts():
    _ensure_seeded()
    db = InvestmentSessionLocal()
    try:
        from app.models.investments import Investor, InvestmentPlan, Payment
        from app.services import auth_service as auth_svc

        personal = db.query(Investor).filter(Investor.name == "סהר").one()
        plan_count = db.query(InvestmentPlan).filter(InvestmentPlan.investor_id == personal.id).count()
        payment_count = db.query(Payment).filter(Payment.investor_id == personal.id).count()

        result = auth_svc.split_admin_and_personal_accounts(db)
        assert result["status"] in {"ok", "already_split"}

        db.expire_all()
        personal = db.query(Investor).filter(Investor.name == "סהר").one()
        admin = db.query(Investor).filter(Investor.name == "מנהל מערכת").one()
        admin_user = db.query(User).filter(User.username == "admin").one()
        personal_user = db.query(User).filter(User.username == "sahar").one()

        assert not personal.is_manager
        assert admin.is_manager
        assert admin_user.role == "manager"
        assert personal_user.role == "investor"
        assert personal_user.investor_id == personal.id
        assert admin_user.investor_id == admin.id
        assert (
            db.query(InvestmentPlan).filter(InvestmentPlan.investor_id == personal.id).count()
            == plan_count
        )
        assert (
            db.query(Payment).filter(Payment.investor_id == personal.id).count()
            == payment_count
        )
        assert db.query(InvestmentPlan).filter(InvestmentPlan.investor_id == admin.id).count() == 0
    finally:
        db.close()


def test_personal_sahar_cannot_access_manager_routes():
    _ensure_seeded()
    _set_password("sahar", "SaharPass1!")
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "sahar", "password": "SaharPass1!"},
    )
    assert login.status_code == 200, login.text
    body = login.json()["user"]
    assert body["role"] == "investor"
    assert body["is_manager"] is False
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    quotes = client.get("/api/v1/investments/quotes", headers=headers)
    assert quotes.status_code == 403

    dash = client.get("/api/v1/investments/dashboard", headers=headers)
    assert dash.status_code == 200
    names = {i["name"] for i in dash.json()["investors_summary"]}
    assert names == {"סהר"}
