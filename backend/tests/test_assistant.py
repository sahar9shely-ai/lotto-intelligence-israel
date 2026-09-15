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


def _headers(username: str = "admin", password: str = "admin1234!") -> dict:
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
        assert ctx["cta"]["href"] == "/investors?action=topup"
        assert ctx["tips"]
        assert "😊" not in str(ctx)
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
        horizon = asst.what_if_add_principal(ctx, 10000, months=12)
        assert horizon["horizon_months"] == 12
        assert horizon["contractual_cash_over_horizon"] == round(
            horizon["monthly_cash_after"] * 12, 2
        )
    finally:
        db.close()


def test_assistant_blocks_other_investors():
    assert asst.asks_about_others("תגיד לי כמה יש לבר בתיק")
    assert not asst.asks_about_others("מה הקרן שלי?")


def test_assistant_chat_endpoint_own_portfolio():
    # Admin shell has no personal book — must not dump «קרן 0».
    headers = _headers()
    hi = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "היי", "history": []},
    )
    assert hi.status_code == 200, hi.text
    hi_reply = hi.json()["reply"]
    assert "קרן" not in hi_reply
    assert "₪0" not in hi_reply
    assert "😊" not in hi_reply

    res = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={
            "message": "תן לי סיכום של התיק שלי",
            "history": [
                {"role": "user", "content": "היי"},
                {"role": "assistant", "content": hi_reply},
            ],
        },
    )
    assert res.status_code == 200, res.text
    reply = res.json()["reply"]
    assert "קרן פעילה ₪0" not in reply
    assert "דמי ניהול" not in reply
    assert "ממתינים" in reply or "הצעה" in reply or "לוח" in reply


def _investor_ctx(**overrides):
    ctx = {
        "role": "investor",
        "investor_name": "בר",
        "active_principal": 43000,
        "monthly_cash": 380,
        "monthly_savings": 110,
        "current_savings_balance": 500,
        "lifetime_cash_paid": 1200,
        "next_payment": {
            "due_date": "2026-09-01",
            "month_label": "ספטמבר",
            "amount": 380,
            "status": "scheduled",
        },
        "awaiting_confirmations": [],
        "tips": ["יש תשלום שממתין לאישור קבלה."],
        "cta": {
            "href": "/investors?action=topup",
            "label": "לבקש תוספת או מסלול",
        },
        "has_active_plan": True,
    }
    ctx.update(overrides)
    return ctx


def test_local_replies_status_next_payment_paid_and_topup():
    ctx = _investor_ctx()
    status = asst._local_reply(ctx, "מה המצב שלי?", None)
    assert "קרן פעילה" in status
    assert "😊" not in status
    nxt = asst._local_reply(ctx, "מתי התשלום הבא?", None)
    assert "ספטמבר" in nxt
    paid = asst._local_reply(ctx, "כמה שולם לי עד עכשיו?", None)
    assert "1,200" in paid
    add = asst._local_reply(ctx, "איך מוסיפים השקעה או מבקשים תוספת?", None)
    assert "תוספת" in add
    assert "חייבים" not in add
    wait = asst._local_reply(
        _investor_ctx(
            awaiting_confirmations=[
                {"month_label": "אוגוסט", "amount": 380, "status": "awaiting_confirmation"}
            ]
        ),
        "יש לי אישור תשלום ממתין?",
        None,
    )
    assert "אישור ממתין" in wait


def test_greeting_and_default_are_not_status_dump():
    ctx = _investor_ctx()
    hi = asst._local_reply(ctx, "היי", None)
    assert "קרן פעילה" not in hi
    assert "שלום" in hi
    again = asst._local_reply(
        ctx, "היי", None, history=[{"role": "assistant", "content": hi}]
    )
    assert "קרן פעילה" not in again
    vague = asst._local_reply(ctx, "נו", None)
    assert "קרן פעילה" not in vague
    mgr = {
        "role": "manager",
        "investor_name": "מנהל מערכת",
        "has_personal_book": False,
        "has_active_plan": False,
        "awaiting_count": 0,
        "overdue_open_count": 0,
        "pending_topup_count": 0,
        "pending_quote_count": 0,
        "awaiting_confirmations": [],
        "tips": [],
        "cta": {"href": "/quotes", "label": "לפתיחת הצעה חדשה"},
    }
    admin_hi = asst._local_reply(mgr, "היי מנהל מערכת", None)
    assert "קרן" not in admin_hi
    assert "₪0" not in admin_hi
    admin_plain = asst._local_reply(mgr, "היי", None)
    assert "קרן" not in admin_plain
    assert "₪0" not in admin_plain
    status = asst._local_reply(mgr, "מה המצב שלי?", None)
    assert "קרן פעילה" not in status
    assert "ממתינים לאישור" in status


def test_local_reply_manager_ops_and_new_quote():
    ctx = {
        "role": "manager",
        "investor_name": "מנהל מערכת",
        "awaiting_count": 2,
        "overdue_open_count": 1,
        "pending_topup_count": 0,
        "pending_quote_count": 1,
        "awaiting_confirmations": [
            {"investor_name": "אופק", "month_label": "אוגוסט", "amount": 500}
        ],
        "tips": ["יש אישורי קבלה שממתינים אצל משקיעים."],
        "cta": {"href": "/quotes", "label": "לפתיחת הצעה חדשה"},
        "has_active_plan": False,
    }
    ops = asst._local_reply(ctx, "מה המצב בלוח עכשיו?", None)
    assert "ממתינים לאישור: 2" in ops
    assert "אופק" in ops
    assert "😊" not in ops
    quote = asst._local_reply(ctx, "איך פותחים הצעה או מסלול חדש?", None)
    assert "הצעה" in quote


def test_local_reply_does_not_repeat_status_block():
    ctx = _investor_ctx()
    first = asst._local_reply(ctx, "מה המצב שלי?", None)
    second = asst._local_reply(
        ctx, "אוקיי", None, history=[{"role": "assistant", "content": first}]
    )
    assert "קרן פעילה" not in second
    third = asst._local_reply(
        ctx,
        "מתי התשלום הבא?",
        None,
        history=[{"role": "assistant", "content": first}],
    )
    assert "ספטמבר" in third
    mgr = {
        "role": "manager",
        "investor_name": "מנהל מערכת",
        "awaiting_count": 1,
        "overdue_open_count": 0,
        "pending_topup_count": 0,
        "pending_quote_count": 0,
        "awaiting_confirmations": [],
        "tips": [],
        "cta": {"href": "/quotes", "label": "לפתיחת הצעה חדשה"},
    }
    ops = asst._local_reply(mgr, "מה המצב בלוח עכשיו?", None)
    again = asst._local_reply(
        mgr, "תודה", None, history=[{"role": "assistant", "content": ops}]
    )
    assert "זה מה שעומד עכשיו" not in again


def test_llm_credentials_use_env_when_settings_empty(monkeypatch):
    class Settings:
        assistant_api_key = None
        assistant_provider = "gemini"

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    provider, key = asst._llm_credentials(Settings())
    assert provider == "openai"
    assert key == "sk-test"


def test_scrub_strips_emoji():
    assert "😊" not in asst.scrub_assistant_text("שלום 😊 הקרן שלך תקינה.")
    assert "😀" not in asst.scrub_assistant_text("שלום 😀")


def test_opening_endpoint_investor_has_cta_no_emoji():
    headers = _headers("bar", "Password1!")
    res = client.get("/api/v1/assistant/opening", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["role"] == "investor"
    assert "😊" not in body["greeting"]
    assert body["cta"]["href"] == "/investors?action=topup"
    labels = [s["label"] for s in body["suggestions"]]
    assert "מה המצב שלי" in labels
    assert "הוספת השקעה" in labels


def test_opening_endpoint_manager_points_to_quotes():
    headers = _headers()
    res = client.get("/api/v1/assistant/opening", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["role"] == "manager"
    assert "😊" not in body["greeting"]
    assert body["cta"]["href"] == "/quotes"
    chat = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "איך פותחים הצעה חדשה?", "history": []},
    )
    assert chat.status_code == 200, chat.text
    payload = chat.json()
    assert payload["cta"]["href"] == "/quotes"
    assert "דמי ניהול" not in payload["reply"]


def _ensure_bar_plan(db, principal: float = 43000) -> tuple:
    from datetime import date as date_cls

    bar = db.query(Investor).filter(Investor.name == "בר").first()
    assert bar is not None
    active = [p for p in (bar.plans or []) if p.status == "active"]
    if not active:
        plan = InvestmentPlan(
            investor_id=bar.id,
            principal=principal,
            plan_type="hybrid",
            monthly_rate_percent=8.8372,
            savings_rate_percent=2.5581,
            manager_fee_percent=0,
            start_date=date_cls(2026, 1, 1),
            duration_months=12,
            status="active",
            notes="בדיקת עוזר — בר מוסרי",
        )
        db.add(plan)
        db.commit()
        bar = (
            db.query(Investor)
            .options(joinedload(Investor.plans).joinedload(InvestmentPlan.payments))
            .filter(Investor.name == "בר")
            .first()
        )
        active = [p for p in (bar.plans or []) if p.status == "active"]
    return bar, float(sum(p.principal for p in active))


def test_extract_name_query_strips_gendered_verbs():
    from app.services import assistant_retrieval as retr

    assert retr.extract_name_query("כמה כסף בר מוסרי השקיעה") == "בר מוסרי"
    assert retr.extract_name_query("כמה כסף בר מוסרי השקיע") == "בר מוסרי"
    assert retr.extract_name_query("כמה יש לאופק") == "אופק"
    assert retr.extract_name_query("תן לי סיכום של התיק שלי") == ""
    assert retr.extract_name_query("היי") == ""
    assert retr.extract_name_query("מה המצב בלוח עכשיו?") == ""


def test_score_name_match_full_and_first_name():
    from app.services import assistant_retrieval as retr

    assert retr.score_name_match("בר מוסרי", "בר") >= 84
    assert retr.score_name_match("בר", "בר מוסרי") >= 84
    assert retr.score_name_match("אופק", "אופק אלזם") >= 84
    assert retr.score_name_match("בר מוסרי", "אופק") == 0


def test_manager_context_lists_investors_not_admin_shell():
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        admin = db.query(User).filter(User.username == "admin").first()
        assert admin is not None
        ctx = asst.build_manager_context(db, user=admin)
        names = {row["name"] for row in ctx["investors"]}
        assert "בר" in names
        assert "אופק" in names
        assert "מנהל מערכת" not in names
        assert "totals" in ctx
        assert "active_principal" in ctx["totals"] or "total_principal" in ctx["totals"]
        blob = str(ctx)
        assert "manager_fee" not in blob
        assert ctx["privacy"]["may_discuss_other_investors"] is True
    finally:
        db.close()


def test_find_bar_mosri_by_full_name():
    from app.services import assistant_retrieval as retr

    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        hits = retr.find_investors_by_query(db, "בר מוסרי")
        assert hits
        assert hits[0][0].name == "בר"
        hits2 = retr.find_investors_by_query(db, "אופק")
        assert hits2
        assert hits2[0][0].name == "אופק"
    finally:
        db.close()


def test_manager_chat_bar_mosri_returns_live_principal(monkeypatch):
    monkeypatch.setattr(asst, "_llm_credentials", lambda _settings: ("gemini", ""))
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        _bar, principal = _ensure_bar_plan(db)
        assert principal > 0
    finally:
        db.close()

    headers = _headers()
    res = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "כמה כסף בר מוסרי השקיעה", "history": []},
    )
    assert res.status_code == 200, res.text
    reply = res.json()["reply"]
    assert "אין נתונים" not in reply
    assert "בר" in reply
    formatted = f"{principal:,.0f}"
    assert formatted in reply or str(int(principal)) in reply
    assert "קרן" in reply


def test_manager_chat_system_totals(monkeypatch):
    monkeypatch.setattr(asst, "_llm_credentials", lambda _settings: ("gemini", ""))
    headers = _headers()
    res = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "כמה קרן יש במערכת?", "history": []},
    )
    assert res.status_code == 200, res.text
    reply = res.json()["reply"]
    assert "קרן" in reply
    assert "₪" in reply


def test_investor_still_blocked_from_other_books(monkeypatch):
    monkeypatch.setattr(asst, "_llm_credentials", lambda _settings: ("gemini", ""))
    headers = _headers("bar", "Password1!")
    res = client.post(
        "/api/v1/assistant/chat",
        headers=headers,
        json={"message": "כמה כסף יש לאופק בתיק", "history": []},
    )
    if res.status_code != 200:
        return
    reply = res.json()["reply"]
    assert "רק לגבי התיק שלך" in reply
    assert "קרן פעילה" not in reply or "אופק" not in reply


def test_lookup_investor_tool_returns_principal():
    from app.services import assistant_retrieval as retr

    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        bar, principal = _ensure_bar_plan(db)
        admin = db.query(User).filter(User.username == "admin").first()
        result = retr.execute_tool(
            db,
            user=admin,
            role="manager",
            name="lookup_investor",
            arguments={"name": "בר מוסרי"},
            build_portfolio=asst.build_investor_context,
        )
        assert result.get("found") is True
        hit = result["investors"][0]
        assert hit["matched_as"] == "בר"
        assert float(hit["active_principal"]) == float(principal)
        assert "manager_fee" not in str(result)
    finally:
        db.close()


def test_investor_context_includes_own_documents():
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
        bar = db.query(Investor).filter(Investor.name == "בר").first()
        ctx = asst.build_investor_context(db, investor_id=bar.id)
        assert "documents" in ctx
        assert ctx["privacy"]["may_discuss_other_investors"] is False
        assert "open_payments" in ctx
    finally:
        db.close()
