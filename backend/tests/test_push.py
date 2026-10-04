"""Web-push ownership, outbox transactions and provider failure behavior.

All outbound delivery is mocked. These tests never contact a push provider.
"""
import base64
import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.api.v1.push import router
from app.api.v1.auth import router as auth_router
from app.core.config import settings
from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.models.auth import LoginAlert, User
from app.models.investments import Investor, InvestmentPlan, InvestmentTopupRequest, Payment, PlanAgreement, PlanNotice, utcnow
from app.models.push import PushDelivery, PushNotice, PushSubscription
from app.security.auth import create_access_token, enforce_notification_access, hash_password
from app.services import push_service as push


def encoded(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


@pytest.fixture
def push_env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'push.db'}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    InvestmentBase.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    key = ec.generate_private_key(ec.SECP256R1())
    public = encoded(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    private = encoded(key.private_numbers().private_value.to_bytes(32, "big"))
    monkeypatch.setattr(settings, "web_push_enabled", True)
    monkeypatch.setattr(settings, "web_push_require_notifications", False)
    monkeypatch.setattr(settings, "web_push_vapid_public_key", public)
    monkeypatch.setattr(settings, "web_push_vapid_private_key", private)
    monkeypatch.setattr(settings, "web_push_vapid_subject", "https://tazrim.example")
    monkeypatch.setattr(settings, "admin_only_maintenance", False)
    with sessions() as db:
        first = Investor(name="Private investor name")
        other = Investor(name="Other private investor name")
        db.add_all([first, other]); db.flush()
        users = [User(username="push-one", investor_id=first.id, password_hash=hash_password("Synthetic1!")),
                 User(username="push-two", investor_id=other.id, password_hash=hash_password("Synthetic2!"))]
        db.add_all(users); db.flush()
        plan = InvestmentPlan(investor_id=first.id, principal=99777, start_date=date(2026, 1, 1))
        db.add(plan); db.flush()
        payment = Payment(plan_id=plan.id, investor_id=first.id, month_number=1, due_date=date(2026, 2, 1),
                          investor_amount=6543, status="scheduled", confirmation_requested_at=None)
        db.add(payment); db.commit()
        ids = [user.id for user in users]
        payment_id = payment.id
        investor_id = first.id
    app = FastAPI(); app.include_router(router); app.include_router(auth_router)

    def database():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_investment_db] = database
    headers = [{"Authorization": "Bearer " + create_access_token(user_id=user_id, role="investor", investor_id=investor_id)} for user_id in ids]
    endpoint = "https://fcm.googleapis.com/wpush/v2/synthetic-secret"
    payload = {"endpoint": endpoint, "keys": {"p256dh": public, "auth": encoded(b"a" * 16)}}
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, sessions=sessions, headers=headers, payload=payload,
                              user_ids=ids, investor_id=investor_id, payment_id=payment_id)
    engine.dispose()


def register(env, index=0, endpoint=None):
    payload = {**env.payload, "endpoint": endpoint or env.payload["endpoint"]}
    response = env.client.post("/api/v1/push/subscriptions", headers=env.headers[index], json=payload)
    assert response.status_code == 200, response.text
    return payload["endpoint"]


def enqueue_payment(env):
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        payment.status = "awaiting_confirmation"
        payment.confirmation_requested_at = payment.confirmation_requested_at or utcnow()
        assert push.enqueue_payment(db, payment) == 1
        db.commit()


def test_config_authentication_and_no_secret_material(push_env, monkeypatch):
    env = push_env
    assert env.client.get("/api/v1/push/config").status_code == 401
    response = env.client.get("/api/v1/push/config", headers=env.headers[0])
    assert response.json() == {"enabled": True, "public_key": settings.web_push_vapid_public_key, "require_notifications": False}
    assert settings.web_push_vapid_private_key not in response.text
    monkeypatch.setattr(settings, "web_push_vapid_private_key", encoded(b"b" * 32))
    assert env.client.get("/api/v1/push/config", headers=env.headers[0]).json()["enabled"] is False
    assert env.client.post("/api/v1/push/subscriptions", headers=env.headers[0], json=env.payload).status_code == 503


def test_vapid_pkcs8_der_private_key_supported_without_key_change(push_env, monkeypatch):
    raw = push._decode_key(settings.web_push_vapid_private_key, 32)
    key = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1())
    der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = settings.web_push_vapid_public_key
    monkeypatch.setattr(settings, "web_push_vapid_private_key", encoded(der))
    assert push.is_enabled()
    assert push.public_config()["public_key"] == public
    assert push_env.client.get("/api/v1/push/config", headers=push_env.headers[0]).json()["enabled"]


def test_disabled_feature_never_touches_business_transaction(push_env, monkeypatch):
    monkeypatch.setattr(settings, "web_push_enabled", False)
    db = Mock()
    item = Mock()
    assert push.enqueue_payment(db, item) == 0
    assert push.enqueue_agreement(db, item) == 0
    assert push.enqueue_topup_contract(db, item) == 0
    assert db.mock_calls == []


def test_notification_access_gate_owner_only_and_help_routes_allowed(push_env, monkeypatch):
    env = push_env
    monkeypatch.setattr(settings, "web_push_require_notifications", True)
    with env.sessions() as db:
        user = db.get(User, env.user_ids[0])
        for path in ("/api/v1/auth/me", "/api/v1/auth/me/password", "/api/v1/push/config", "/api/v1/push/subscriptions/status", "/api/v1/tutorials", "/api/v1/tutorials/8"):
            enforce_notification_access(user, db, path)
        with pytest.raises(HTTPException) as blocked:
            enforce_notification_access(user, db, "/api/v1/investments/payments")
        assert blocked.value.status_code == 428
        user.role = "manager"
        enforce_notification_access(user, db, "/api/v1/investments/payments")
        user.role = "investor"
        user.investor.is_manager = True
        enforce_notification_access(user, db, "/api/v1/investments/payments")
        user.investor.is_manager = False
    register(env, index=1)
    with env.sessions() as db:
        with pytest.raises(HTTPException) as blocked:
            enforce_notification_access(db.get(User, env.user_ids[0]), db, "/api/v1/assistant/send")
        assert blocked.value.status_code == 428
    register(env, endpoint="https://fcm.googleapis.com/wpush/own-device")
    with env.sessions() as db:
        enforce_notification_access(db.get(User, env.user_ids[0]), db, "/api/v1/investments/payments")


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/wpush/token", "https://127.0.0.1/private", "https://localhost/private",
    "https://fcm.googleapis.com.evil.example/token", "https://evil.example/fcm.googleapis.com/token",
    "https://fcm.googleapis.com@127.0.0.1/token", "https://fcm.googleapis.com:444/token",
    "https://fcm.googleapis.com/token#fragment", "https://fcm.googleapis.com\\@127.0.0.1/token",
    "https://fcm.googleapis.com\n/token", "https://notify.windows.com/token", "https://push.apple.com/token",
])
def test_ssrf_endpoints_rejected(push_env, endpoint):
    env = push_env
    response = env.client.post("/api/v1/push/subscriptions", headers=env.headers[0], json={**env.payload, "endpoint": endpoint})
    assert response.status_code == 400
    with env.sessions() as db:
        assert db.query(PushSubscription).count() == 0


@pytest.mark.parametrize("endpoint", [
    "https://fcm.googleapis.com/wpush/v2/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://updates-autopush.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/Q/token",
    "https://wns2-db5p.notify.windows.com/w/?token=synthetic&x=1",
])
def test_official_browser_endpoints_supported(push_env, endpoint):
    register(push_env, endpoint=endpoint)


def test_keys_cap_and_cross_account_binding_and_delete(push_env):
    env = push_env
    invalid = {**env.payload, "keys": {"p256dh": encoded(b"a" * 65), "auth": encoded(b"a" * 16)}}
    assert env.client.post("/api/v1/push/subscriptions", headers=env.headers[0], json=invalid).status_code == 400
    endpoint = register(env)
    assert env.client.post("/api/v1/push/subscriptions", headers=env.headers[1], json=env.payload).status_code == 409
    foreign = env.client.get("/api/v1/push/subscriptions/status", headers=env.headers[1], params={"endpoint": endpoint})
    assert foreign.json() == {"subscribed": False}
    env.client.request("DELETE", "/api/v1/push/subscriptions", headers=env.headers[1], json={"endpoint": endpoint})
    assert env.client.get("/api/v1/push/subscriptions/status", headers=env.headers[0], params={"endpoint": endpoint}).json()["subscribed"]
    for number in range(9):
        register(env, endpoint=f"https://fcm.googleapis.com/wpush/device-{number}")
    assert env.client.post("/api/v1/push/subscriptions", headers=env.headers[0], json={**env.payload, "endpoint": "https://fcm.googleapis.com/wpush/eleventh"}).status_code == 400
    assert env.client.post("/api/v1/push/subscriptions", headers=env.headers[0], json=env.payload).status_code == 200
    assert env.client.delete("/api/v1/push/subscriptions/all", headers=env.headers[1]).status_code == 200
    with env.sessions() as db:
        assert db.query(PushSubscription).count() == 10
    env.client.request("DELETE", "/api/v1/push/subscriptions", headers=env.headers[0], json={"endpoint": endpoint})
    register(env, index=1)
    with env.sessions() as db:
        assert db.query(PushSubscription).filter_by(endpoint=endpoint).one().user_id == env.user_ids[1]


def test_transaction_rollback_has_no_fanout_and_duplicates_do_not_resend(push_env):
    env = push_env; register(env)
    with patch.object(push, "_send_push") as send:
        with env.sessions() as db:
            payment = db.get(Payment, env.payment_id)
            payment.status = "awaiting_confirmation"; payment.confirmation_requested_at = utcnow()
            assert push.enqueue_payment(db, payment) == 1
            db.rollback()
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        send.assert_not_called()
        enqueue_payment(env)
        with env.sessions() as db:
            assert push.enqueue_payment(db, db.get(Payment, env.payment_id)) == 0
            db.commit()
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        assert send.call_count == 1
        subscription, payload = send.call_args.args
        assert subscription.user_id == env.user_ids[0]
        assert payload["data"]["owner_user_id"] == env.user_ids[0]
        assert f"payment_id={env.payment_id}" in payload["data"]["href"]
        serialized = json.dumps(payload)
        for secret in ("Private investor name", "6543", "99777", "synthetic-secret", "Bearer"):
            assert secret not in serialized


@pytest.mark.parametrize("change", ["paid", "rejected", "inactive", "different_owner", "expired"])
def test_revalidate_pending_owner_and_expiry_before_delivery(push_env, change):
    env = push_env; register(env); enqueue_payment(env)
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        if change == "paid": payment.status = "paid"
        if change == "rejected": payment.status = "scheduled"; payment.confirmation_requested_at = None
        if change == "inactive": db.get(User, env.user_ids[0]).is_active = False
        if change == "different_owner": payment.investor_id = db.get(User, env.user_ids[1]).investor_id
        if change == "expired": db.query(PushNotice).one().expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        send.assert_not_called()
    with env.sessions() as db:
        assert db.query(PushDelivery).one().status == "cancelled"


def test_reissued_payment_cancels_prior_event_and_auto_paid_does_not_enqueue(push_env):
    env = push_env; register(env); enqueue_payment(env)
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        payment.confirmation_requested_at += timedelta(seconds=1)
        assert push.enqueue_payment(db, payment) == 1
        db.commit()
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 1
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id); payment.status = "paid"
        assert push.enqueue_payment(db, payment) == 0


def test_logout_unbind_cancels_queued_delivery_and_no_replay_on_account_switch(push_env):
    env = push_env; register(env); enqueue_payment(env)
    response = env.client.request("DELETE", "/api/v1/push/subscriptions", headers=env.headers[0], json={"endpoint": env.payload["endpoint"]})
    assert response.status_code == 200
    register(env, index=1)
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        send.assert_not_called()


def make_agreement(env):
    with env.sessions() as db:
        notice = PlanNotice(investor_id=env.investor_id, purpose="new", requested_on=date(2026, 1, 1), actor_user_id=env.user_ids[0])
        db.add(notice); db.flush()
        agreement = PlanAgreement(investor_id=env.investor_id, kind="open", status="pending", snapshot={"secret": "99777"},
            private_terms={"secret": "private financial terms"}, token_hash="a" * 64, document_hash="b" * 64,
            notice_id=notice.id, actor_user_id=env.user_ids[0], created_at=push.utcnow(), expires_at=utcnow() + timedelta(days=14))
        db.add(agreement); db.flush()
        assert push.enqueue_agreement(db, agreement) == 1
        db.commit()
        return agreement.id


def test_agreement_new_link_revisions_and_signed_expired_cancel(push_env):
    env = push_env; register(env); agreement_id = make_agreement(env)
    with env.sessions() as db:
        agreement = db.get(PlanAgreement, agreement_id)
        assert push.enqueue_agreement(db, agreement) == 0
        agreement.token_hash = "c" * 64
        assert push.enqueue_agreement(db, agreement) == 1
        db.commit()
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 1
        payload = send.call_args.args[1]
        assert payload["data"]["href"] == f"/agreements/{agreement_id}/sign"
        assert "99777" not in json.dumps(payload)
        assert "c" * 64 not in json.dumps(payload)
    with env.sessions() as db:
        agreement = db.get(PlanAgreement, agreement_id)
        agreement.token_hash = "d" * 64
        assert push.enqueue_agreement(db, agreement) == 1
        agreement.status = "signed"; agreement.signed_at = utcnow()
        assert push.enqueue_agreement(db, agreement) == 0
        db.commit()
    with patch.object(push, "_send_push") as send:
        push.run_pending_pushes(session_factory=env.sessions)
        send.assert_not_called()


def test_topup_contract_revision_unsigned_only(push_env):
    env = push_env; register(env)
    with env.sessions() as db:
        request = InvestmentTopupRequest(investor_id=env.investor_id, amount=99777, status="contract", offered_at=utcnow())
        db.add(request); db.flush()
        assert push.enqueue_topup_contract(db, request) == 1
        assert push.enqueue_topup_contract(db, request) == 0
        request.offered_at += timedelta(seconds=1)
        assert push.enqueue_topup_contract(db, request) == 1
        db.commit()
        request_id = request.id
    with patch.object(push, "_send_push") as send:
        push.run_pending_pushes(session_factory=env.sessions)
        assert send.call_count == 1
        assert f"topup_request_id={request_id}" in send.call_args.args[1]["data"]["href"]
    with env.sessions() as db:
        request = db.get(InvestmentTopupRequest, request_id)
        request.investor_signed_at = utcnow()
        assert push.enqueue_topup_contract(db, request) == 0


def test_atomic_claim_durable_lease_prevents_concurrent_sends(push_env):
    env = push_env; register(env); enqueue_payment(env)
    with env.sessions() as first, env.sessions() as second:
        claimed = push._claim_one(first, utcnow())
        assert claimed is not None
        assert push._claim_one(second, utcnow()) is None
        first.query(PushDelivery).one().claimed_at = utcnow() - timedelta(minutes=3)
        first.commit()
        reclaimed = push._claim_one(second, utcnow())
        assert reclaimed is not None and reclaimed[0] == claimed[0] and reclaimed[1] != claimed[1]


class ProviderFailure(Exception):
    def __init__(self, code):
        self.response = SimpleNamespace(status_code=code)


@pytest.mark.parametrize("code", [404, 410])
def test_expired_provider_subscription_is_removed(push_env, code):
    env = push_env; register(env); enqueue_payment(env)
    with patch.object(push, "_send_push", side_effect=ProviderFailure(code)):
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    with env.sessions() as db:
        assert db.query(PushSubscription).count() == 0
        assert db.query(PushDelivery).count() == 0


@pytest.mark.parametrize("code", [400, 401, 403])
def test_permanent_provider_failure_is_bounded_and_does_not_leak_errors(push_env, code):
    env = push_env; register(env); enqueue_payment(env)
    with patch.object(push, "_send_push", side_effect=ProviderFailure(code)) as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        assert send.call_count == 1
    with env.sessions() as db:
        delivery = db.query(PushDelivery).one()
        assert delivery.status == "failed"
        assert delivery.last_error_code == f"http_{code}"
        assert db.query(PushSubscription).count() == 1


@pytest.mark.parametrize("code", [429, 500, None])
def test_transient_provider_failures_retry_with_backoff_and_stop(push_env, code):
    env = push_env; register(env); enqueue_payment(env)
    with patch.object(push, "_send_push", side_effect=ProviderFailure(code)) as send:
        for attempt in range(1, push.MAX_ATTEMPTS + 1):
            assert push.run_pending_pushes(session_factory=env.sessions) == 1
            with env.sessions() as db:
                delivery = db.query(PushDelivery).one()
                assert delivery.attempts == attempt
                assert delivery.status == ("failed" if attempt == push.MAX_ATTEMPTS else "queued")
                if attempt < push.MAX_ATTEMPTS:
                    assert delivery.next_attempt_at.replace(tzinfo=utcnow().tzinfo) > utcnow()
                    assert push.run_pending_pushes(session_factory=env.sessions) == 0
                    delivery.next_attempt_at = utcnow() - timedelta(seconds=1)
                    db.commit()
        assert send.call_count == push.MAX_ATTEMPTS


def test_transport_blocks_redirects_and_uses_timeout(push_env):
    env = push_env; register(env)
    with patch("requests.Session.request", return_value=Mock(status_code=302)) as request:
        with push._NoRedirectSession() as transport:
            transport.post("https://fcm.googleapis.com/wpush/token", allow_redirects=True)
        assert request.call_args.kwargs["allow_redirects"] is False
    with env.sessions() as db:
        subscription = db.query(PushSubscription).one()
        with patch("pywebpush.webpush") as send:
            push._send_push(subscription, {"title": "Generic"})
            assert send.call_args.kwargs["timeout"] == 8
            assert send.call_args.kwargs["requests_session"].trust_env is False


def test_actual_encryption_and_vapid_authentication_with_mock_transport(push_env, monkeypatch):
    """Exercise the installed pywebpush encoder/signer, never its network."""
    import requests

    env = push_env; register(env)
    response = requests.Response(); response.status_code = 201
    with env.sessions() as db:
        subscription = db.query(PushSubscription).one()
        raw = push._decode_key(settings.web_push_vapid_private_key, 32)
        key = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1())
        der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        monkeypatch.setattr(settings, "web_push_vapid_private_key", encoded(der))
        with patch("requests.Session.request", return_value=response) as transport:
            push._send_push(subscription, {"title": "תזרים", "body": "ממתין מסמך", "data": {"owner_user_id": env.user_ids[0]}})
            assert transport.call_count == 1
            call = transport.call_args
            assert call.kwargs["allow_redirects"] is False
            assert call.kwargs["timeout"] == 8
            assert call.kwargs["headers"]["content-encoding"] == "aes128gcm"
            assert call.kwargs["headers"]["Authorization"].startswith("vapid ")
            assert isinstance(call.kwargs["data"], bytes)
            assert b"owner_user_id" not in call.kwargs["data"]


def test_payment_business_hook_enqueues_in_same_transaction_and_auto_owner_is_silent(push_env):
    from app.services import investment_service as investments

    env = push_env; register(env)
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        payment.status = "scheduled"; payment.confirmation_requested_at = None
        db.commit()
    with patch.object(push, "_send_push") as send:
        with env.sessions() as db:
            payment = db.get(Payment, env.payment_id)
            actor = db.get(User, env.user_ids[1])
            investments.request_payment_confirmation(db, payment=payment, actor=actor, commit=False)
            assert db.query(PushNotice).count() == 1
            assert push.run_pending_pushes(session_factory=env.sessions) == 0
            send.assert_not_called()
            db.rollback()
        with env.sessions() as db:
            assert db.query(PushNotice).count() == 0
            payment = db.get(Payment, env.payment_id)
            assert payment.status == "scheduled"
            investments.request_payment_confirmation(db, payment=payment, actor=db.get(User, env.user_ids[1]))
            assert db.query(PushNotice).count() == 1
            investments.request_payment_confirmation(db, payment=payment, actor=db.get(User, env.user_ids[1]))
            assert db.query(PushNotice).count() == 1
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert send.call_count == 1
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        payment.status = "scheduled"; payment.confirmation_requested_at = None
        db.commit()
        result = investments.request_payment_confirmation(db, payment=payment, actor=db.get(User, env.user_ids[0]))
        assert result["auto"] is True
        assert payment.status == "paid"
        assert db.query(PushNotice).count() == 1


def test_agreement_business_hook_rollback_and_duplicate_signature_cancel_pending_push(push_env):
    from app.services import agreement_service as agreements

    env = push_env; register(env)
    today = date(2026, 10, 4)
    with env.sessions() as db:
        db.query(InvestmentPlan).filter_by(investor_id=env.investor_id).one().status = "completed"
        notice = PlanNotice(investor_id=env.investor_id, purpose="new", requested_on=today, actor_user_id=env.user_ids[1])
        db.add(notice); db.commit(); notice_id = notice.id
    data = {"principal": 99777, "additional_funds": 99777, "plan_type": "monthly", "monthly_rate_percent": 2,
            "savings_rate_percent": 0, "start_date": today, "duration_months": 12}
    with patch.object(agreements, "israel_today", return_value=today), patch.object(push, "_send_push") as send:
        with env.sessions() as db:
            agreement, _token = agreements.issue(db, investor_id=env.investor_id, kind="open", actor_id=env.user_ids[1], notice_id=notice_id, data=data)
            assert db.query(PushNotice).count() == 1
            db.rollback()
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        send.assert_not_called()
        with env.sessions() as db:
            agreement, _token = agreements.issue(db, investor_id=env.investor_id, kind="open", actor_id=env.user_ids[1], notice_id=notice_id, data=data)
            db.commit()
            assert db.query(PushNotice).count() == 1
            assert push.enqueue_agreement(db, agreement) == 0
            agreement.status = "signed"; agreement.signed_at = utcnow()
            db.commit()
            assert push.enqueue_agreement(db, agreement) == 0
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        send.assert_not_called()


def test_topup_business_hook_enqueues_and_unsigned_reoffer_creates_new_revision(push_env):
    from app.services import investment_service as investments

    env = push_env; register(env)
    with patch.object(push, "_send_push") as send:
        with env.sessions() as db:
            request = InvestmentTopupRequest(investor_id=env.investor_id, amount=99777, status="pending")
            db.add(request); db.commit()
            terms = dict(plan_type="monthly", monthly_rate_percent=2, savings_rate_percent=0, manager_fee_percent=0,
                         start_date=date(2026, 10, 4), duration_months=12, actor_user_id=env.user_ids[1])
            investments.offer_topup_contract(db, request=request, **terms)
            assert db.query(PushNotice).count() == 1
            assert request.status == "contract"
            assert send.call_count == 0
            investments.offer_topup_contract(db, request=request, **terms)
            assert db.query(PushNotice).count() == 2
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 1


def test_enable_notifications_catches_up_requests_created_before_opt_in_once(push_env):
    env = push_env
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        payment.status = "awaiting_confirmation"; payment.confirmation_requested_at = utcnow()
        assert push.enqueue_payment(db, payment) == 0
        assert db.query(PushNotice).count() == 0
        db.commit()
    with patch.object(push, "_send_push") as send:
        register(env)
        send.assert_not_called()
        register(env)
        with env.sessions() as db:
            assert db.query(PushNotice).count() == 1
            assert db.query(PushDelivery).count() == 1
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert send.call_count == 1
        register(env)
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        assert send.call_count == 1


def test_new_device_catches_up_without_replaying_other_device_or_other_account(push_env):
    env = push_env; register(env); enqueue_payment(env)
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        first_device = send.call_args.args[0].id
        register(env, index=1, endpoint="https://fcm.googleapis.com/wpush/other-owner")
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        register(env, endpoint="https://fcm.googleapis.com/wpush/second-device")
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert send.call_count == 2
        assert send.call_args.args[0].id != first_device
        assert send.call_args.args[0].user_id == env.user_ids[0]
        register(env)
        register(env, endpoint="https://fcm.googleapis.com/wpush/second-device")
        assert push.run_pending_pushes(session_factory=env.sessions) == 0


def test_expired_event_catchup_does_not_revive_stale_delivery_on_other_device(push_env):
    env = push_env; register(env); enqueue_payment(env)
    with env.sessions() as db:
        old = db.query(PushNotice).one()
        old.expires_at = utcnow() - timedelta(days=1)
        old_id = old.id
        db.commit()
    register(env, endpoint="https://fcm.googleapis.com/wpush/fresh-device")
    with env.sessions() as db:
        assert db.get(PushNotice, old_id).expires_at.replace(tzinfo=utcnow().tzinfo) < utcnow()
        assert db.query(PushNotice).count() == 2
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 1
        assert send.call_args.args[0].endpoint.endswith("fresh-device")
        register(env, endpoint="https://fcm.googleapis.com/wpush/fresh-device")
        assert push.run_pending_pushes(session_factory=env.sessions) == 0


def test_device_catchup_only_unsigned_unexpired_owned_agreements_and_contracts(push_env):
    env = push_env
    with env.sessions() as db:
        notice = PlanNotice(investor_id=env.investor_id, purpose="new", requested_on=date(2026, 1, 1), actor_user_id=env.user_ids[0])
        db.add(notice); db.flush()
        for index, (status, signed, expired, owner) in enumerate([
            ("pending", False, False, env.investor_id),
            ("signed", True, False, env.investor_id),
            ("pending", False, True, env.investor_id),
            ("cancelled", False, False, env.investor_id),
            ("pending", False, False, db.get(User, env.user_ids[1]).investor_id),
        ]):
            db.add(PlanAgreement(investor_id=owner, kind="open", status=status, snapshot={}, private_terms={},
                token_hash=f"{index:064x}", document_hash="b" * 64, notice_id=notice.id,
                actor_user_id=env.user_ids[0], signed_at=utcnow() if signed else None,
                expires_at=utcnow() + timedelta(days=-1 if expired else 14)))
        for status, signed in [("contract", False), ("contract", True), ("executed", False), ("pending", False)]:
            db.add(InvestmentTopupRequest(investor_id=env.investor_id, amount=99777, status=status,
                offered_at=utcnow(), investor_signed_at=utcnow() if signed else None))
        db.commit()
    register(env)
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 2
        for call in send.call_args_list:
            assert call.args[0].user_id == env.user_ids[0]
            assert call.args[1]["data"]["owner_user_id"] == env.user_ids[0]
    with env.sessions() as db:
        assert {notice.kind for notice in db.query(PushNotice).all()} == {"agreement", "topup"}


def test_catchup_registration_transaction_can_roll_back_without_delivery(push_env):
    env = push_env
    with env.sessions() as db:
        payment = db.get(Payment, env.payment_id)
        payment.status = "awaiting_confirmation"; payment.confirmation_requested_at = utcnow()
        db.commit()
        device = push.subscribe(db, db.get(User, env.user_ids[0]), endpoint=env.payload["endpoint"], **env.payload["keys"])
        assert push.enqueue_outstanding_for_device(db, device) == 1
        db.rollback()
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        send.assert_not_called()
    with env.sessions() as db:
        assert db.query(PushSubscription).count() == 0
        assert db.query(PushNotice).count() == 0


def test_fixed_provider_diagnostics_never_include_private_exception_or_device(push_env, caplog):
    env = push_env; register(env); enqueue_payment(env)
    failure = ProviderFailure(403)
    failure.args = ("synthetic-secret Private investor name 6543 Bearer provider secret",)
    with patch.object(push, "_send_push", side_effect=failure):
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    assert "Push delivery failed (http_403)" in caplog.text
    for value in ("synthetic-secret", "Private investor name", "6543", "Bearer", env.payload["keys"]["auth"]):
        assert value not in caplog.text


def add_manager(env, username="admin", role="manager", manager_investor=True):
    with env.sessions() as db:
        investor = Investor(name="Synthetic administrator", is_manager=manager_investor)
        db.add(investor); db.flush()
        user = User(username=username, investor_id=investor.id, role=role, password_hash=hash_password("SyntheticAdmin1!"))
        db.add(user); db.commit()
        return user.id, {"Authorization": "Bearer " + create_access_token(user_id=user.id, role=user.role, investor_id=investor.id)}


def test_login_push_only_successful_investor_login_to_exact_verified_admin(push_env):
    from app.services import auth_service

    env = push_env
    admin_id, admin_header = add_manager(env)
    other_id, _ = add_manager(env, username="another-manager")
    with env.sessions() as db:
        # Legacy other-manager enrollments still cannot become login recipients.
        push.subscribe(db, db.get(User, other_id), endpoint="https://fcm.googleapis.com/wpush/legacy-manager", **env.payload["keys"])
        db.commit()
    assert env.client.post("/api/v1/push/subscriptions", headers=admin_header,
        json={**env.payload, "endpoint": "https://fcm.googleapis.com/wpush/admin-device"}).status_code == 200
    with env.sessions() as db:
        with pytest.raises(ValueError):
            auth_service.login_user(db, "push-one", "WrongPassword!")
        assert db.query(LoginAlert).count() == 0
        assert db.query(PushNotice).count() == 0
        auth_service.login_user(db, "push-one", "Synthetic1!")
        notice = db.query(PushNotice).one()
        assert notice.kind == "admin_login" and notice.user_id == admin_id
        alert = db.query(LoginAlert).one()
        assert push.enqueue_investor_login(db, alert) == 0
        db.commit()
    for _ in range(2):
        assert env.client.get("/api/v1/auth/me", headers=env.headers[0]).status_code == 200
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert send.call_count == 1
        device, payload = send.call_args.args
        assert device.user_id == admin_id
        assert payload["kind"] == "admin_login"
        assert payload["data"]["href"] == "/activity"
        assert payload["data"]["owner_user_id"] == admin_id
        for secret in ("Private investor name", "push-one", "99777", "6543", "Synthetic"):
            assert secret not in json.dumps(payload)
    with env.sessions() as db:
        auth_service.login_user(db, "admin", "SyntheticAdmin1!")
        assert db.query(PushNotice).count() == 1


@pytest.mark.parametrize("change", ["inactive", "renamed", "not_manager"])
def test_login_push_revalidates_admin_privilege_before_sending(push_env, change):
    from app.services import auth_service

    env = push_env; admin_id, header = add_manager(env)
    assert env.client.post("/api/v1/push/subscriptions", headers=header, json=env.payload).status_code == 200
    with env.sessions() as db:
        auth_service.login_user(db, "push-one", "Synthetic1!")
        admin = db.get(User, admin_id)
        if change == "inactive": admin.is_active = False
        if change == "renamed": admin.username = "former-admin"
        if change == "not_manager": admin.role = "investor"; admin.investor.is_manager = False
        db.commit()
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        send.assert_not_called()


def test_device_test_current_owner_only_one_device_idempotent_and_safe_status(push_env):
    env = push_env; first = register(env)
    register(env, endpoint="https://fcm.googleapis.com/wpush/another-owned-device")
    register(env, index=1, endpoint="https://fcm.googleapis.com/wpush/another-account")
    with patch.object(push, "_send_push") as send:
        response = env.client.post("/api/v1/push/test", headers=env.headers[0], json={"endpoint": first})
        assert response.status_code == 200
        delivery_id = response.json()["delivery_id"]
        repeated = env.client.post("/api/v1/push/test", headers=env.headers[0], json={"endpoint": first})
        assert repeated.json()["delivery_id"] == delivery_id
        send.assert_not_called()
        foreign = env.client.post("/api/v1/push/test", headers=env.headers[1], json={"endpoint": first})
        assert foreign.status_code == 409
        hidden = env.client.post("/api/v1/push/delivery-status", headers=env.headers[1],
            json={"endpoint": first, "delivery_id": delivery_id})
        assert hidden.json() == {"subscribed": False, "pending": 0, "last_delivery": None}
        waiting = env.client.post("/api/v1/push/delivery-status", headers=env.headers[0],
            json={"endpoint": first, "delivery_id": delivery_id})
        assert waiting.json()["last_delivery"] == {"status": "queued", "error": None, "sent_at": None}
        assert waiting.json()["pending"] == 1
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert send.call_count == 1
        assert send.call_args.args[0].endpoint == first
        assert send.call_args.args[1]["kind"] == "test"
        assert send.call_args.args[1]["data"]["href"] == "/account"
        accepted = env.client.post("/api/v1/push/delivery-status", headers=env.headers[0],
            json={"endpoint": first, "delivery_id": delivery_id})
        assert accepted.json()["last_delivery"]["status"] == "sent"
        assert accepted.json()["last_delivery"]["sent_at"] is not None
        assert accepted.json()["pending"] == 0
        for secret in (first, env.payload["keys"]["auth"], "Private investor name", "6543"):
            assert secret not in accepted.text
        # A delivery id from a different own device does not reveal that device's state.
        other = env.client.post("/api/v1/push/delivery-status", headers=env.headers[0],
            json={"endpoint": "https://fcm.googleapis.com/wpush/another-owned-device", "delivery_id": delivery_id})
        assert other.json()["last_delivery"] is None


def test_other_manager_cannot_enroll_or_test_and_fake_admin_is_not_privileged(push_env):
    env = push_env
    for username, role, manager_investor in [("another-manager", "manager", True), ("admin", "investor", False)]:
        _, header = add_manager(env, username=username, role=role, manager_investor=manager_investor)
        subscribed = env.client.post("/api/v1/push/subscriptions", headers=header,
            json={**env.payload, "endpoint": "https://fcm.googleapis.com/wpush/" + username})
        if role == "manager":
            assert subscribed.status_code == 403
            assert env.client.post("/api/v1/push/test", headers=header, json={"endpoint": env.payload["endpoint"]}).status_code == 403
            assert env.client.post("/api/v1/push/delivery-status", headers=header, json={"endpoint": env.payload["endpoint"]}).status_code == 403
        else:
            assert subscribed.status_code == 200
            with env.sessions() as db:
                actor = db.get(User, env.user_ids[0])
                alert = LoginAlert(user_id=actor.id, investor_id=actor.investor_id,
                    email="synthetic", display_name="synthetic", logged_in_at=utcnow())
                db.add(alert); db.flush()
                assert push.enqueue_investor_login(db, alert) == 0


def old_pending_agreement(env, *, offered_on=None):
    with env.sessions() as db:
        notice = PlanNotice(investor_id=env.investor_id, purpose="new", requested_on=date(2026, 1, 1), actor_user_id=env.user_ids[0])
        db.add(notice); db.flush()
        agreement = PlanAgreement(investor_id=env.investor_id, kind="open", status="pending", snapshot={}, private_terms={},
            token_hash="a" * 64, document_hash="b" * 64, notice_id=notice.id, actor_user_id=env.user_ids[0],
            created_at=offered_on or utcnow() - timedelta(days=2), expires_at=utcnow() + timedelta(days=14))
        db.add(agreement); db.commit()
        return agreement.id


def test_daily_reminders_israel_daytime_once_and_missing_days_not_replayed(push_env, monkeypatch):
    env = push_env; register(env); agreement_id = old_pending_agreement(env)
    today = datetime(2026, 10, 5, 10, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    with patch.object(push, "utcnow", return_value=today):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=today - timedelta(hours=1)) == 0
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=today) == 1
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=today + timedelta(hours=1)) == 0
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=today + timedelta(hours=10)) == 0
    # Wake after a missed day: only today's pending request is queued. Older
    # unsent reminders expire rather than causing a burst of missed-day pushes.
    waking = today + timedelta(days=3)
    with patch.object(push, "utcnow", return_value=waking):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=waking) == 1
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=waking) == 0
        with patch.object(push, "_send_push") as send:
            assert push.run_pending_pushes(session_factory=env.sessions) == 2
            assert send.call_count == 1
            payload = send.call_args.args[1]
            assert payload["kind"] == "agreement_reminder"
            assert payload["data"]["href"] == f"/agreements/{agreement_id}/sign"
    with env.sessions() as db:
        assert db.query(PushNotice).filter_by(kind="agreement_reminder").count() == 2


def test_initial_request_not_reminded_again_today_signature_and_new_revision_revalidated(push_env):
    env = push_env; register(env)
    now = datetime(2026, 10, 5, 10, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    with patch.object(push, "utcnow", return_value=now):
        agreement_id = make_agreement(env)
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=now) == 0
        with patch.object(push, "_send_push"):
            assert push.run_pending_pushes(session_factory=env.sessions) == 1
    tomorrow = now + timedelta(days=1)
    with patch.object(push, "utcnow", return_value=tomorrow):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=tomorrow) == 1
        with env.sessions() as db:
            agreement = db.get(PlanAgreement, agreement_id)
            agreement.status = "signed"; agreement.signed_at = tomorrow
            db.commit()
        with patch.object(push, "_send_push") as send:
            push.run_pending_pushes(session_factory=env.sessions)
            send.assert_not_called()
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=tomorrow + timedelta(days=1)) == 0


def test_unsigned_topup_reminder_and_reminder_disable_setting(push_env, monkeypatch):
    env = push_env; register(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    with env.sessions() as db:
        request = InvestmentTopupRequest(investor_id=env.investor_id, amount=99777, status="contract", offered_at=now - timedelta(days=1))
        db.add(request); db.commit(); request_id = request.id
    with patch.object(push, "utcnow", return_value=now):
        monkeypatch.setattr(settings, "web_push_agreement_reminders_enabled", False)
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=now) == 0
        monkeypatch.setattr(settings, "web_push_agreement_reminders_enabled", True)
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=now) == 1
        with env.sessions() as db:
            request = db.get(InvestmentTopupRequest, request_id)
            request.investor_signed_at = now
            db.commit()
        with patch.object(push, "_send_push") as send:
            assert push.run_pending_pushes(session_factory=env.sessions) == 1
            send.assert_not_called()


def test_waking_with_unsent_original_does_not_double_send_reminder_same_day(push_env):
    env = push_env; register(env)
    yesterday = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    with patch.object(push, "utcnow", return_value=yesterday):
        make_agreement(env)
    waking = yesterday + timedelta(days=1)
    with patch.object(push, "utcnow", return_value=waking):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=waking) == 0
        with patch.object(push, "_send_push") as send:
            assert push.run_pending_pushes(session_factory=env.sessions) == 1
            assert send.call_count == 1
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=waking + timedelta(hours=1)) == 0
    next_day = waking + timedelta(days=1)
    with patch.object(push, "utcnow", return_value=next_day):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=next_day) == 1


def test_reminder_scan_failure_does_not_block_normal_outbox_delivery(caplog):
    from app.main import _push_delivery_loop

    with patch.object(push, "run_scheduled_reminders", side_effect=RuntimeError("private endpoint")) as scan, \
         patch.object(push, "run_pending_pushes", return_value=0) as drain, \
         patch("app.main.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError)):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(_push_delivery_loop())
        scan.assert_called_once()
        drain.assert_called_once_with(limit=10)
    assert "Push reminder scan failed" in caplog.text
    assert "private endpoint" not in caplog.text


def test_login_push_transaction_rollback_never_notifies(push_env):
    from app.services import auth_service

    env = push_env; _, header = add_manager(env)
    assert env.client.post("/api/v1/push/subscriptions", headers=header, json=env.payload).status_code == 200
    with env.sessions() as db:
        auth_service.notify_manager_login(db, db.get(User, env.user_ids[0]))
        assert db.query(PushNotice).count() == 1
        db.rollback()
    with patch.object(push, "_send_push") as send:
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        send.assert_not_called()


@pytest.mark.parametrize("change", ["signed", "cancelled", "expired", "revision"])
def test_daily_reminder_revalidates_document_after_queue(push_env, change):
    env = push_env; register(env); agreement_id = old_pending_agreement(env)
    now = datetime(2026, 10, 5, 10, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    with patch.object(push, "utcnow", return_value=now):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=now) == 1
        with env.sessions() as db:
            agreement = db.get(PlanAgreement, agreement_id)
            if change == "signed": agreement.signed_at = now; agreement.status = "signed"
            if change == "cancelled": agreement.status = "cancelled"
            if change == "expired": agreement.expires_at = now - timedelta(seconds=1)
            if change == "revision": agreement.token_hash = "c" * 64
            db.commit()
        with patch.object(push, "_send_push") as send:
            assert push.run_pending_pushes(session_factory=env.sessions) == 1
            send.assert_not_called()


def current_reminder_agreement(env, now, *, offered_at=None):
    from app.services.agreement_service import digest

    agreement_id = old_pending_agreement(env, offered_on=offered_at or now - timedelta(days=2))
    with env.sessions() as db:
        agreement = db.get(PlanAgreement, agreement_id)
        agreement.document_hash = digest(agreement.snapshot)
        agreement.expires_at = now + timedelta(days=14)
        db.commit()
        return agreement_id, agreement.document_hash


@pytest.mark.parametrize("actor", ["investor", "other_manager", "fake_admin"])
def test_manual_signature_reminder_exact_admin_authorization(push_env, actor):
    env = push_env
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    if actor == "investor":
        header = env.headers[0]
    elif actor == "other_manager":
        _, header = add_manager(env, username="another-manager")
    else:
        _, header = add_manager(env, username="admin", role="investor", manager_investor=False)
    response = env.client.post(f"/api/v1/push/agreements/{agreement_id}/reminder", headers=header,
        json={"document_hash": document_hash})
    assert response.status_code == 403
    assert env.client.post(f"/api/v1/push/agreements/{agreement_id}/reminder",
        json={"document_hash": document_hash}).status_code == 401
    with env.sessions() as db:
        assert db.query(PushDelivery).count() == 0


@pytest.mark.parametrize("change", ["stale_hash", "changed_snapshot", "signed", "cancelled", "expired", "missing"])
def test_manual_signature_reminder_rejects_stale_or_completed_document(push_env, change):
    env = push_env; register(env); _, header = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    with env.sessions() as db:
        agreement = db.get(PlanAgreement, agreement_id)
        if change == "stale_hash": document_hash = "0" * 64
        if change == "changed_snapshot": agreement.snapshot = {"changed": "document"}
        if change == "signed": agreement.status = "signed"; agreement.signed_at = now
        if change == "cancelled": agreement.status = "cancelled"
        if change == "expired": agreement.expires_at = now
        db.commit()
    target = agreement_id + 1000 if change == "missing" else agreement_id
    with patch.object(push, "utcnow", return_value=now), patch.object(push, "_send_push") as send:
        response = env.client.post(f"/api/v1/push/agreements/{target}/reminder", headers=header,
            json={"document_hash": document_hash})
        assert response.status_code == (404 if change == "missing" else 409)
        send.assert_not_called()
    with env.sessions() as db:
        assert db.query(PushDelivery).count() == 0


def test_manual_signature_reminder_no_device_and_disabled_are_honest(push_env, monkeypatch):
    env = push_env; _, header = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    url = f"/api/v1/push/agreements/{agreement_id}/reminder"
    with patch.object(push, "utcnow", return_value=now), patch.object(push, "_send_push") as send:
        response = env.client.post(url, headers=header, json={"document_hash": document_hash})
        assert response.json() == {"queued": False, "devices": 0, "reason": "no_devices", "next_eligible_at": None}
        assert env.client.post(url, headers=header, json={"document_hash": document_hash, "investor_id": 2}).status_code == 422
        assert env.client.post(url, headers=header, json={"document_hash": "bad"}).status_code == 422
        monkeypatch.setattr(settings, "web_push_enabled", False)
        assert env.client.post(url, headers=header, json={"document_hash": document_hash}).status_code == 503
        send.assert_not_called()
    with env.sessions() as db:
        assert db.query(PushNotice).count() == 0


def test_manual_signature_reminder_scopes_devices_and_preserves_agreement(push_env):
    env = push_env; register(env)
    register(env, endpoint="https://fcm.googleapis.com/wpush/own-second")
    register(env, index=1, endpoint="https://fcm.googleapis.com/wpush/foreign-investor")
    admin_id, header = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    with env.sessions() as db:
        push.subscribe(db, db.get(User, admin_id), endpoint="https://fcm.googleapis.com/wpush/admin-device", **env.payload["keys"])
        before = dict(db.get(PlanAgreement, agreement_id).snapshot)
        balance = db.get(Investor, env.investor_id).available_balance_cents
        db.commit()
    with patch.object(push, "utcnow", return_value=now), patch.object(push, "_send_push") as send:
        response = env.client.post(f"/api/v1/push/agreements/{agreement_id}/reminder", headers=header,
            json={"document_hash": document_hash})
        assert response.status_code == 200
        assert response.json()["queued"] and response.json()["devices"] == 2
        assert response.json()["reason"] == "queued"
        send.assert_not_called()
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert {call.args[0].user_id for call in send.call_args_list} == {env.user_ids[0]}
        assert all(call.args[1]["kind"] == "agreement_reminder" for call in send.call_args_list)
        assert all(call.args[1]["data"]["href"] == f"/agreements/{agreement_id}/sign" for call in send.call_args_list)
        assert "99777" not in response.text and env.payload["endpoint"] not in response.text
    with env.sessions() as db:
        agreement = db.get(PlanAgreement, agreement_id)
        assert agreement.snapshot == before and agreement.status == "pending" and agreement.signed_at is None
        assert db.get(Investor, env.investor_id).available_balance_cents == balance


@pytest.mark.parametrize("change", ["inactive", "role_manager", "investor_manager"])
def test_manual_signature_reminder_excludes_inactive_or_manager_owner(push_env, change):
    env = push_env; register(env); _, header = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    with env.sessions() as db:
        owner = db.get(User, env.user_ids[0])
        if change == "inactive": owner.is_active = False
        if change == "role_manager": owner.role = "manager"
        if change == "investor_manager": owner.investor.is_manager = True
        db.commit()
    with patch.object(push, "utcnow", return_value=now):
        result = env.client.post(f"/api/v1/push/agreements/{agreement_id}/reminder", headers=header,
            json={"document_hash": document_hash}).json()
        assert result["reason"] == "no_devices" and result["devices"] == 0
    with env.sessions() as db:
        assert db.query(PushDelivery).count() == 0


def test_manual_signature_reminder_inflight_suppression_and_elapsed_hour_cooldown(push_env):
    env = push_env; register(env); _, header = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now, offered_at=now)
    url = f"/api/v1/push/agreements/{agreement_id}/reminder"
    payload = {"document_hash": document_hash}
    with patch.object(push, "utcnow", return_value=now):
        with env.sessions() as db:
            assert push.enqueue_agreement(db, db.get(PlanAgreement, agreement_id)) == 1
            db.commit()
        assert env.client.post(url, headers=header, json=payload).json()["reason"] == "already_pending"
        with env.sessions() as db:
            db.query(PushDelivery).one().status = "sending"
            db.query(PushDelivery).one().claimed_at = now
            db.commit()
        assert env.client.post(url, headers=header, json=payload).json()["reason"] == "already_pending"
        with env.sessions() as db:
            db.query(PushDelivery).one().status = "queued"
            db.commit()
        with patch.object(push, "_send_push"):
            assert push.run_pending_pushes(session_factory=env.sessions) == 1
        # Explicit admin follow-up is allowed after initial issuance on the same day.
        assert env.client.post(url, headers=header, json=payload).json()["reason"] == "queued"
        assert env.client.post(url, headers=header, json=payload).json()["reason"] == "already_pending"
    accepted = now + timedelta(minutes=10)
    with patch.object(push, "utcnow", return_value=accepted), patch.object(push, "_send_push"):
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    with patch.object(push, "utcnow", return_value=now + timedelta(hours=1)):
        recent = env.client.post(url, headers=header, json=payload).json()
        assert recent["reason"] == "recently_sent" and not recent["queued"]
        assert datetime.fromisoformat(recent["next_eligible_at"]) == accepted + timedelta(hours=1)
    with patch.object(push, "utcnow", return_value=accepted + timedelta(hours=1)):
        assert env.client.post(url, headers=header, json=payload).json()["reason"] == "queued"
    with env.sessions() as db:
        assert db.query(PushNotice).count() == 3


def test_automatic_signature_reminder_waits_24_hours_from_delayed_acceptance(push_env):
    env = push_env; register(env)
    issued = datetime(2026, 10, 5, 19, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, _ = current_reminder_agreement(env, issued, offered_at=issued)
    with patch.object(push, "utcnow", return_value=issued):
        with env.sessions() as db:
            push.enqueue_agreement(db, db.get(PlanAgreement, agreement_id)); db.commit()
    accepted = issued + timedelta(minutes=15)
    with patch.object(push, "utcnow", return_value=accepted), patch.object(push, "_send_push"):
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    for check in [issued + timedelta(hours=15), accepted + timedelta(hours=24, seconds=-1)]:
        with patch.object(push, "utcnow", return_value=check):
            assert push.run_scheduled_reminders(session_factory=env.sessions, now=check) == 0
    eligible = accepted + timedelta(hours=24)
    with patch.object(push, "utcnow", return_value=eligible):
        assert push.run_scheduled_reminders(session_factory=env.sessions, now=eligible) == 1
    reminder_accepted = eligible + timedelta(minutes=30)
    with patch.object(push, "utcnow", return_value=reminder_accepted), patch.object(push, "_send_push"):
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    with patch.object(push, "utcnow", return_value=reminder_accepted + timedelta(hours=24, seconds=-1)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 0
    with patch.object(push, "utcnow", return_value=reminder_accepted + timedelta(hours=24)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 1


def test_manual_reminder_resets_automatic_24_hour_interval(push_env):
    env = push_env; register(env); _, header = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    with patch.object(push, "utcnow", return_value=now):
        assert env.client.post(f"/api/v1/push/agreements/{agreement_id}/reminder", headers=header,
            json={"document_hash": document_hash}).json()["queued"]
    accepted = now + timedelta(minutes=5)
    with patch.object(push, "utcnow", return_value=accepted), patch.object(push, "_send_push"):
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    with patch.object(push, "utcnow", return_value=accepted + timedelta(hours=24, seconds=-1)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 0
    with patch.object(push, "utcnow", return_value=accepted + timedelta(hours=24)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 1


def test_automatic_offer_age_and_dst_use_elapsed_utc_hours(push_env):
    env = push_env; register(env)
    # Israel's spring transition makes 10:00 -> next-day 10:00 only 23 hours.
    offered = datetime(2027, 3, 25, 10, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    next_local_morning = datetime(2027, 3, 26, 10, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    assert next_local_morning - offered == timedelta(hours=23)
    current_reminder_agreement(env, offered, offered_at=offered)
    with patch.object(push, "utcnow", return_value=next_local_morning):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 0
    with patch.object(push, "utcnow", return_value=offered + timedelta(hours=24)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 1


def test_reissued_link_resets_24_hour_interval_for_current_revision(push_env):
    env = push_env; register(env)
    reissued = datetime(2026, 10, 5, 19, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    original = reissued - timedelta(days=2)
    agreement_id, _ = current_reminder_agreement(env, reissued, offered_at=original)
    with patch.object(push, "utcnow", return_value=original), patch.object(push, "_send_push"):
        with env.sessions() as db:
            push.enqueue_agreement(db, db.get(PlanAgreement, agreement_id)); db.commit()
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    with patch.object(push, "utcnow", return_value=reissued), patch.object(push, "_send_push"):
        with env.sessions() as db:
            agreement = db.get(PlanAgreement, agreement_id)
            agreement.token_hash = "c" * 64
            assert push.enqueue_agreement(db, agreement) == 1
            db.commit()
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
    with patch.object(push, "utcnow", return_value=reissued + timedelta(hours=15)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 0
    with patch.object(push, "utcnow", return_value=reissued + timedelta(hours=24, seconds=-1)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 0
    with patch.object(push, "utcnow", return_value=reissued + timedelta(hours=24)):
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 1
    with env.sessions() as db:
        reminder = db.query(PushNotice).filter_by(kind="agreement_reminder").one()
        assert reminder.entity_revision == "c" * 64


@pytest.mark.parametrize("second_action", ["manual", "automatic"])
def test_manual_and_automatic_signature_reminders_share_concurrent_guard(push_env, second_action):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    env = push_env; register(env); admin_id, _ = add_manager(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    agreement_id, document_hash = current_reminder_agreement(env, now)
    ready = Barrier(2)

    def attempt(action):
        with env.sessions() as db:
            ready.wait(timeout=5)
            if action == "manual":
                result = push.enqueue_manual_agreement_reminder(db, db.get(User, admin_id), agreement_id, document_hash)
                count = result["devices"]
            else:
                count = push.enqueue_agreement_reminders(db, now=now)
            db.commit()
            return count

    with patch.object(push, "utcnow", return_value=now), patch.object(push, "_send_push") as send:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(attempt, "manual"), pool.submit(attempt, second_action)]
            assert sum(future.result(timeout=10) for future in futures) == 1
        send.assert_not_called()
    with env.sessions() as db:
        assert db.query(PushNotice).filter_by(kind="agreement_reminder").count() == 1
        assert db.query(PushDelivery).count() == 1


def test_postgresql_registration_lock_and_document_mutex_avoid_financial_row_locks(push_env):
    from sqlalchemy.dialects import postgresql

    env = push_env
    dialect = postgresql.dialect()
    db = Mock()
    db.get_bind.return_value.dialect.name = "postgresql"
    owner = SimpleNamespace(id=env.user_ids[0])
    existing = SimpleNamespace(user_id=owner.id)
    db.query.return_value.filter_by.return_value.one_or_none.return_value = existing
    push.subscribe(db, owner, endpoint=env.payload["endpoint"], **env.payload["keys"])
    cap_sql = str(db.execute.call_args_list[0].args[0].compile(dialect=dialect))
    assert "FOR NO KEY UPDATE" in cap_sql
    assert "FOR UPDATE" not in cap_sql
    db.reset_mock()
    push._lock_reminder_item(db, PlanAgreement, 123)
    first = db.execute.call_args.args[0].compile(dialect=dialect)
    assert "pg_advisory_xact_lock" in str(first)
    assert "FOR UPDATE" not in str(first)
    assert -(2 ** 63) <= next(iter(first.params.values())) < 2 ** 63
    db.query.return_value.filter.return_value.with_for_update.assert_not_called()
    push._lock_reminder_item(db, PlanAgreement, 123)
    assert first.params == db.execute.call_args.args[0].compile(dialect=dialect).params
    push._lock_reminder_item(db, InvestmentTopupRequest, 123)
    assert first.params != db.execute.call_args.args[0].compile(dialect=dialect).params


def stale_original_with_current_document(env, now, kind):
    issued = now - timedelta(days=17)
    if kind == "agreement":
        entity_id, _ = current_reminder_agreement(env, now, offered_at=issued)
        with patch.object(push, "utcnow", return_value=issued), env.sessions() as db:
            push.enqueue_agreement(db, db.get(PlanAgreement, entity_id))
            # Synthetic old notice expiry while the document remains live.
            db.query(PushNotice).one().expires_at = now - timedelta(days=1)
            db.commit()
        return entity_id
    with patch.object(push, "utcnow", return_value=issued), env.sessions() as db:
        request = InvestmentTopupRequest(investor_id=env.investor_id, amount=99777,
            status="contract", offered_at=issued)
        db.add(request); db.flush()
        push.enqueue_topup_contract(db, request)
        db.commit()
        return request.id


@pytest.mark.parametrize("kind", ["agreement", "topup"])
def test_signature_reminder_and_same_device_catchup_do_not_duplicate(push_env, kind):
    env = push_env; register(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    stale_original_with_current_document(env, now, kind)
    with patch.object(push, "utcnow", return_value=now), patch.object(push, "_send_push") as send:
        assert push.run_scheduled_reminders(session_factory=env.sessions) == 1
        register(env); register(env)
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 1
        assert send.call_args.args[1]["kind"] == f"{kind}_reminder"
        # Reconciliation after provider acceptance is also not another message.
        register(env)
        assert push.run_pending_pushes(session_factory=env.sessions) == 0
        # A new device still receives the outstanding document immediately.
        register(env, endpoint="https://fcm.googleapis.com/wpush/new-device-catchup")
        assert push.run_pending_pushes(session_factory=env.sessions) == 1
        assert send.call_count == 2
        assert send.call_args.args[0].endpoint.endswith("new-device-catchup")


@pytest.mark.parametrize("kind", ["agreement", "topup"])
def test_concurrent_existing_device_reconciliation_and_auto_reminder_share_guard(push_env, kind):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    env = push_env; register(env)
    now = datetime(2026, 10, 5, 11, tzinfo=push.ISRAEL_TZ).astimezone(timezone.utc)
    stale_original_with_current_document(env, now, kind)
    ready = Barrier(2)

    def reconcile():
        ready.wait(timeout=5)
        response = env.client.post("/api/v1/push/subscriptions", headers=env.headers[0], json=env.payload)
        assert response.status_code == 200, response.text

    def automatic():
        ready.wait(timeout=5)
        return push.run_scheduled_reminders(session_factory=env.sessions, now=now)

    with patch.object(push, "utcnow", return_value=now), patch.object(push, "_send_push") as send:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(reconcile), pool.submit(automatic)]
            for future in futures:
                future.result(timeout=10)
        send.assert_not_called()
        assert push.run_pending_pushes(session_factory=env.sessions) == 2
        assert send.call_count == 1
    with env.sessions() as db:
        assert db.query(PushDelivery).filter_by(status="sent").count() == 1
