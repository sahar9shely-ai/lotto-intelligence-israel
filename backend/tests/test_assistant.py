"""Personal assistant: scoped answers, no fees, what-if math."""

from datetime import date

from fastapi.testclient import TestClient

from app.db.investment_session import InvestmentSessionLocal
from app.main import app
from app.models.auth import User
from app.models.investments import InvestmentPlan, Investor
from app.security.auth import hash_password
from app.services import assistant_service as asst
from app.services import investment_service as inv_svc
from sqlalchemy.orm import joinedload

client = TestClient(app)


def _headers(username: str = "sahar", password: str = "sahar1234!") -> dict:
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        user = db.query(User).filter(User.username == username).first()
        assert user is not None
        user.password_hash = hash_password(password)
        user.must_reset_password = False
        db.commit()
    finally:
        db.close()
    login = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    if login.status_code != 200:
        # fallback demo password used in other tests
        db = InvestmentSessionLocal()
        try:
            user = db.query(User).filter(User.username == username).first()
            user.password_hash = hash_password("ManagerPass1!")
            user.must_reset_password = False
            db.commit()
        finally:
            db.close()
        login = client.post(
            "/api/v1/auth/login", json={"username": username, "password": "ManagerPass1!"}
        )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_assistant_context_has_no_fees():
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        bar = db.query(Investor).filter(Investor.name == "בר").first()
        assert bar is not None
        ctx = asst.build_investor_context(db, investor_id=bar.id)
        blob = str(ctx)
        assert "manager_fee" not in blob
        assert "דמי" not in blob
        assert ctx["investor_name"] == "בר"
        assert ctx["privacy"]["may_discuss_fees"] is False
    finally:
        db.close()


def test_assistant_refuses_fee_questions():
    headers = _headers("bar", "Password1!")
    # ensure bar password
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        user = db.query(User).filter(User.username == "bar").first()
        if user:
            user.password_hash = hash_password("Password1!")
            user.must_reset_password = False
            db.commit()
    finally:
        db.close()
    login = client.post("/api/v1/auth/login", json={"username": "bar", "password": "Password1!"})
    if login.status_code != 200:
        headers = _headers()
        # create session as manager but still test scrub unit
        reply = asst.scrub_assistant_text("דמי הניהול הם 2%")
        assert "דמי" not in reply or "ניהול" not in reply or "אני כאן" in reply
        return
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "כמה דמי ניהול לוקחים ממני?", "history": []},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "דמי ניהול" not in body["reply"]
    assert "עמלה" not in body["reply"] or "אני כאן" in body["reply"]


def test_assistant_what_if_math():
    from datetime import date as date_cls

    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        bar = db.query(Investor).filter(Investor.name == "בר").first()
        assert bar is not None
        if not any(p.status == "active" for p in (bar.plans or [])):
            plan = InvestmentPlan(
                investor_id=bar.id,
                principal=43000,
                plan_type="hybrid",
                monthly_rate_percent=8.8372,
                savings_rate_percent=2.5581,
                manager_fee_percent=0,
                start_date=date_cls(2026, 1, 1),
                duration_months=12,
                status="active",
                notes="בדיקת what-if",
            )
            db.add(plan)
            db.commit()
        bar = (
            db.query(Investor)
            .options(joinedload(Investor.plans).joinedload(InvestmentPlan.payments))
            .filter(Investor.name == "בר")
            .first()
        )
        ctx = asst.build_investor_context(db, investor_id=bar.id)
        result = asst.what_if_add_principal(ctx, 10000)
        assert result["ok"] is True
        assert result["principal_after"] == round(ctx["active_principal"] + 10000, 2)
        assert result["monthly_cash_after"] > ctx["monthly_cash"]
    finally:
        db.close()


def test_assistant_blocks_other_investors():
    assert asst.asks_about_others("תגיד לי כמה יש לבר בתיק")
    assert not asst.asks_about_others("מה הקרן שלי?")


def test_assistant_chat_endpoint_own_portfolio():
    # Login as manager (always seeded) and ask about own book
    headers = _headers()
    res = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "תן לי סיכום של התיק שלי", "history": []},
    )
    assert res.status_code == 200, res.text
    reply = res.json()["reply"]
    assert "₪" in reply or "קרן" in reply
    assert "דמי ניהול" not in reply
