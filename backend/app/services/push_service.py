"""Private, opt-in notifications; enqueue in the business transaction, send later.

Only the outbox runner performs network I/O. A failed or rolled-back financial
operation therefore cannot send a push. The runner uses short delivery leases;
browser notification tags also collapse a retry following a process crash.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

import requests
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from sqlalchemy import func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.investment_session import InvestmentSessionLocal
from app.models.auth import User
from app.models.investments import InvestmentTopupRequest, Payment, PlanAgreement, utcnow
from app.models.push import PushDelivery, PushNotice, PushSubscription

MAX_SUBSCRIPTIONS = 10
MAX_ATTEMPTS = 4
CLAIM_LEASE_SECONDS = 120
RETRY_SECONDS = (60, 300, 1800)
logger = logging.getLogger(__name__)


class SubscriptionConflict(ValueError):
    pass


class SubscriptionLimit(ValueError):
    pass


def is_enabled() -> bool:
    if not settings.web_push_enabled:
        return False
    try:
        public = _decode_key(settings.web_push_vapid_public_key.strip(), 65)
        private = _decode_base64(settings.web_push_vapid_private_key.strip(), max_chars=512)
        key = ec.derive_private_key(int.from_bytes(private, "big"), ec.SECP256R1()) if len(private) == 32 else serialization.load_der_private_key(private, password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
            return False
        derived = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
        )
        subject = urlsplit(settings.web_push_vapid_subject.strip())
        return public == derived and subject.scheme == "https" and bool(subject.hostname) and subject.username is None and subject.password is None
    except (ValueError, TypeError):
        return False


def public_config() -> dict:
    enabled = is_enabled()
    return {"enabled": enabled, "public_key": settings.web_push_vapid_public_key if enabled else None,
            "require_notifications": settings.web_push_require_notifications}


def validate_endpoint(endpoint: str) -> str:
    """Restrict outbound requests to browser vendors' official push services.

    Retain query strings: Windows notification endpoints use them. Reject URL
    ambiguities before parsing, normalize the origin, and never follow redirects.
    """
    if (
        not isinstance(endpoint, str)
        or not 1 <= len(endpoint) <= 2048
        or not endpoint.isascii()
        or re.search(r"[\s\\\x00-\x1f\x7f]", endpoint)
    ):
        raise ValueError("כתובת ההתראות אינה תקינה")
    try:
        parsed = urlsplit(endpoint)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError as exc:
        raise ValueError("כתובת ההתראות אינה תקינה") from exc
    allowed = host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
    allowed = allowed or host.endswith(".push.services.mozilla.com") or host.endswith(".notify.windows.com")
    if (
        parsed.scheme != "https"
        or not allowed
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.fragment
        or not parsed.path.startswith("/")
        or parsed.path == "/"
    ):
        raise ValueError("כתובת ההתראות אינה נתמכת")
    return urlunsplit(("https", host, parsed.path, parsed.query, ""))


def _decode_base64(value: str, *, max_chars: int = 100) -> bytes:
    if not isinstance(value, str) or len(value) > max_chars or not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
        raise ValueError("מפתח ההתראות אינו תקין")
    try:
        decoded = base64.b64decode(value.rstrip("=") + "=" * (-len(value.rstrip("=")) % 4), altchars=b"-_", validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("מפתח ההתראות אינו תקין") from exc
    return decoded


def _decode_key(value: str, length: int) -> bytes:
    decoded = _decode_base64(value)
    if len(decoded) != length:
        raise ValueError("מפתח ההתראות אינו תקין")
    return decoded


def validate_keys(p256dh: str, auth: str) -> tuple[str, str]:
    public = _decode_key(p256dh, 65)
    secret = _decode_key(auth, 16)
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    except ValueError as exc:
        raise ValueError("מפתח ההתראות אינו תקין") from exc
    return (
        base64.urlsafe_b64encode(public).decode().rstrip("="),
        base64.urlsafe_b64encode(secret).decode().rstrip("="),
    )


def _hash_endpoint(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()


def _insert_ignore(db: Session, model, values: dict, conflict_columns: list[str]) -> bool:
    dialect = db.get_bind().dialect.name
    insert = sqlite_insert if dialect == "sqlite" else pg_insert
    result = db.execute(insert(model).values(**values).on_conflict_do_nothing(index_elements=conflict_columns))
    return result.rowcount == 1


def subscribe(db: Session, user: User, *, endpoint: str, p256dh: str, auth: str) -> PushSubscription:
    endpoint = validate_endpoint(endpoint)
    p256dh, auth = validate_keys(p256dh, auth)
    # Serialize registrations for this account (and its cap) on PostgreSQL.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).scalar_one()
    endpoint_hash = _hash_endpoint(endpoint)
    existing = db.query(PushSubscription).filter_by(endpoint_hash=endpoint_hash).one_or_none()
    if existing:
        if existing.user_id != user.id:
            raise SubscriptionConflict("הדפדפן משויך לחשבון אחר. יש לכבות את ההתראות בחשבון הקודם")
        existing.p256dh, existing.auth = p256dh, auth
        existing.updated_at = utcnow()
        return existing
    if db.query(PushSubscription).filter_by(user_id=user.id).count() >= MAX_SUBSCRIPTIONS:
        raise SubscriptionLimit("מספר המכשירים המרבי הושג. יש לכבות התראות במכשיר אחר")
    values = {
        "user_id": user.id, "endpoint_hash": endpoint_hash, "endpoint": endpoint,
        "p256dh": p256dh, "auth": auth, "created_at": utcnow(), "updated_at": utcnow(),
    }
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    device_count = select(func.count(PushSubscription.id)).where(PushSubscription.user_id == user.id).scalar_subquery()
    statement = insert(PushSubscription).from_select(
        list(values), select(*(literal(value) for value in values.values())).where(device_count < MAX_SUBSCRIPTIONS),
    ).on_conflict_do_nothing(index_elements=["endpoint_hash"])
    inserted = db.execute(statement).rowcount == 1
    row = db.query(PushSubscription).filter_by(endpoint_hash=endpoint_hash).one_or_none()
    if not row:
        raise SubscriptionLimit("מספר המכשירים המרבי הושג. יש לכבות התראות במכשיר אחר")
    if not inserted and row.user_id != user.id:
        raise SubscriptionConflict("הדפדפן משויך לחשבון אחר. יש לכבות את ההתראות בחשבון הקודם")
    return row


def unsubscribe(db: Session, user: User, endpoint: str) -> int:
    endpoint = validate_endpoint(endpoint)
    return db.query(PushSubscription).filter_by(user_id=user.id, endpoint_hash=_hash_endpoint(endpoint)).delete(synchronize_session=False)


def subscription_status(db: Session, user: User, endpoint: str | None = None) -> dict:
    query = db.query(PushSubscription).filter_by(user_id=user.id)
    if endpoint is not None:
        query = query.filter_by(endpoint_hash=_hash_endpoint(validate_endpoint(endpoint)))
    return {"subscribed": query.first() is not None}


def has_active_subscription(db: Session, user: User) -> bool:
    return db.query(PushSubscription.id).filter_by(user_id=user.id).first() is not None


def _revision(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).isoformat(timespec="microseconds")


def _enqueue(db: Session, *, investor_id: int, kind: str, entity_id: int, revision: str,
             expires_at: datetime, device: PushSubscription | None = None) -> int:
    count = 0
    # Legacy stores can contain multiple accounts for one investor; each opted-in
    # account receives only its own deliveries and retains its own device binding.
    users = db.query(User).filter_by(investor_id=investor_id, is_active=True).all()
    if device is not None:
        users = [user for user in users if user.id == device.user_id]
    base_event_key = f"{kind}:{entity_id}:{revision}"
    for user in users:
        subscriptions = [device] if device is not None else db.query(PushSubscription).filter_by(user_id=user.id).all()
        if not subscriptions:
            continue
        event_key = base_event_key
        if device is not None:
            previous = db.query(PushNotice).filter_by(event_key=event_key, user_id=user.id).one_or_none()
            if previous and previous.expires_at.replace(tzinfo=timezone.utc) <= utcnow():
                # Do not revive expired work on older devices. The pending
                # request can have one fresh catch-up on this device instead.
                event_key = f"{base_event_key}:device:{device.endpoint_hash[:24]}"
        _insert_ignore(db, PushNotice, {
            "event_key": event_key, "user_id": user.id, "investor_id": investor_id,
            "kind": kind, "entity_id": entity_id, "entity_revision": revision,
            "created_at": utcnow(), "expires_at": expires_at,
        }, ["event_key", "user_id"])
        notice = db.query(PushNotice).filter_by(event_key=event_key, user_id=user.id).one()
        # A newly opted-in device may need a still-pending request even when an
        # earlier device received it. Keep that earlier delivery immutable.
        for subscription in subscriptions:
            if _insert_ignore(db, PushDelivery, {
                "notice_id": notice.id, "subscription_id": subscription.id,
                "status": "queued", "attempts": 0, "next_attempt_at": utcnow(),
            }, ["notice_id", "subscription_id"]):
                count += 1
    db.flush()
    return count


def enqueue_outstanding_for_device(db: Session, device: PushSubscription) -> int:
    """Catch up a newly enabled device, in the registration transaction only.

    Requests created before opt-in had no deliveries. Reconcile the account's
    current outstanding work without re-sending to devices that already saw it,
    and without sending network traffic before registration has committed.
    """
    if not is_enabled():
        return 0
    user = db.get(User, device.user_id)
    if not user or not user.is_active or user.role == "manager" or not user.investor_id or user.investor.is_manager:
        return 0
    now = utcnow()
    count = 0
    payments = db.query(Payment).filter(
        Payment.investor_id == user.investor_id,
        Payment.status == "awaiting_confirmation",
        Payment.confirmation_requested_at.isnot(None),
    ).all()
    for payment in payments:
        count += _enqueue(db, investor_id=user.investor_id, kind="payment", entity_id=payment.id,
                          revision=_revision(payment.confirmation_requested_at),
                          expires_at=now + timedelta(days=7), device=device)
    agreements = db.query(PlanAgreement).filter(
        PlanAgreement.investor_id == user.investor_id, PlanAgreement.status == "pending",
        PlanAgreement.signed_at.is_(None), PlanAgreement.expires_at > now,
    ).all()
    for agreement in agreements:
        count += _enqueue(db, investor_id=user.investor_id, kind="agreement", entity_id=agreement.id,
                          revision=agreement.token_hash, expires_at=agreement.expires_at, device=device)
    topups = db.query(InvestmentTopupRequest).filter(
        InvestmentTopupRequest.investor_id == user.investor_id,
        InvestmentTopupRequest.status == "contract", InvestmentTopupRequest.investor_signed_at.is_(None),
        InvestmentTopupRequest.offered_at.isnot(None),
    ).all()
    for request in topups:
        count += _enqueue(db, investor_id=user.investor_id, kind="topup", entity_id=request.id,
                          revision=_revision(request.offered_at),
                          expires_at=now + timedelta(days=14), device=device)
    return count


def enqueue_payment(db: Session, payment: Payment) -> int:
    if not is_enabled() or payment.status != "awaiting_confirmation" or payment.confirmation_requested_at is None:
        return 0
    db.flush()
    return _enqueue(db, investor_id=payment.investor_id, kind="payment", entity_id=payment.id,
                    revision=_revision(payment.confirmation_requested_at), expires_at=utcnow() + timedelta(days=7))


def enqueue_agreement(db: Session, agreement: PlanAgreement) -> int:
    if not is_enabled() or agreement.status != "pending" or agreement.signed_at is not None:
        return 0
    db.flush()
    return _enqueue(db, investor_id=agreement.investor_id, kind="agreement", entity_id=agreement.id,
                    revision=agreement.token_hash, expires_at=agreement.expires_at)


def enqueue_topup_contract(db: Session, request: InvestmentTopupRequest) -> int:
    if not is_enabled() or request.status != "contract" or request.investor_signed_at is not None or request.offered_at is None:
        return 0
    db.flush()
    return _enqueue(db, investor_id=request.investor_id, kind="topup", entity_id=request.id,
                    revision=_revision(request.offered_at), expires_at=utcnow() + timedelta(days=14))


def _payload(db: Session, notice: PushNotice, now: datetime) -> dict | None:
    owner = db.get(User, notice.user_id)
    if (
        not owner or not owner.is_active or owner.investor_id != notice.investor_id
        or notice.expires_at.replace(tzinfo=timezone.utc) <= now
    ):
        return None
    if notice.kind == "payment":
        payment = db.get(Payment, notice.entity_id)
        if (not payment or payment.investor_id != notice.investor_id or payment.status != "awaiting_confirmation"
            or not payment.confirmation_requested_at or _revision(payment.confirmation_requested_at) != notice.entity_revision):
            return None
        due = payment.due_date.isoformat()
        href = f"/payments?investor_id={notice.investor_id}&payment_id={payment.id}&year={due[:4]}&month={due[:7]}"
        body = "ממתינה לך בקשה לאישור קבלת תשלום. אפשר לפתוח את האזור האישי."
    elif notice.kind == "agreement":
        agreement = db.get(PlanAgreement, notice.entity_id)
        if (not agreement or agreement.investor_id != notice.investor_id or agreement.status != "pending"
            or agreement.token_hash != notice.entity_revision
            or agreement.signed_at is not None or agreement.expires_at.replace(tzinfo=timezone.utc) <= now):
            return None
        href = f"/agreements/{agreement.id}/sign"
        body = "ממתין לך מסמך לאישור ולחתימה. אפשר לפתוח את האזור האישי."
    elif notice.kind == "topup":
        request = db.get(InvestmentTopupRequest, notice.entity_id)
        if (not request or request.investor_id != notice.investor_id or request.status != "contract"
            or request.investor_signed_at is not None or not request.offered_at
            or _revision(request.offered_at) != notice.entity_revision):
            return None
        href = f"/investors?section=documents&topup_request_id={request.id}"
        body = "ממתין לך מסמך לאישור ולחתימה. אפשר לפתוח את האזור האישי."
    else:
        return None
    return {"title": "תזרים", "body": body, "tag": f"tazrim-push-{notice.id}",
            "data": {"href": href, "owner_user_id": notice.user_id}}


class _NoRedirectSession(requests.Session):
    def request(self, *args, **kwargs):
        kwargs["allow_redirects"] = False
        return super().request(*args, **kwargs)


def _send_push(subscription: PushSubscription, payload: dict) -> None:
    # Lazy import keeps disabled installations working before optional dependency
    # installation. Neither provider errors nor endpoints are written to logs.
    from pywebpush import webpush

    with _NoRedirectSession() as transport:
        transport.trust_env = False
        webpush(
            subscription_info={"endpoint": validate_endpoint(subscription.endpoint),
                               "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth}},
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.web_push_vapid_private_key,
            vapid_claims={"sub": settings.web_push_vapid_subject},
            ttl=3600, timeout=8, requests_session=transport,
        )


def _claim_one(db: Session, now: datetime) -> tuple[int, str] | None:
    lease_cutoff = now - timedelta(seconds=CLAIM_LEASE_SECONDS)
    ready = or_(
        (PushDelivery.status == "queued") & (PushDelivery.next_attempt_at <= now),
        (PushDelivery.status == "sending") & (PushDelivery.claimed_at <= lease_cutoff),
    )
    ids = db.execute(select(PushDelivery.id).where(ready).order_by(PushDelivery.id).limit(20)).scalars().all()
    for delivery_id in ids:
        token = str(uuid.uuid4())
        claimed = db.execute(update(PushDelivery).where(PushDelivery.id == delivery_id, ready).values(
            status="sending", claim_token=token, claimed_at=now, attempts=PushDelivery.attempts + 1,
        ))
        if claimed.rowcount == 1:
            db.commit()
            return delivery_id, token
    db.rollback()
    return None


def run_pending_pushes(*, session_factory=InvestmentSessionLocal, limit: int = 20) -> int:
    """Drain committed work in fresh sessions. Safe for concurrent worker calls.

    Run outside the originating database transaction, for example after request
    completion and every 30 seconds from the application's startup worker.
    """
    if not is_enabled():
        return 0
    processed = 0
    for _ in range(max(0, min(limit, 100))):
        with session_factory() as db:
            now = utcnow()
            claim = _claim_one(db, now)
            if not claim:
                break
            delivery_id, token = claim
            delivery = db.get(PushDelivery, delivery_id)
            if not delivery or delivery.claim_token != token:
                continue
            subscription = db.get(PushSubscription, delivery.subscription_id)
            notice = db.get(PushNotice, delivery.notice_id)
            payload = _payload(db, notice, now) if notice else None
            if (not subscription or not notice or subscription.user_id != notice.user_id or not payload
                or delivery.attempts > MAX_ATTEMPTS):
                db.execute(update(PushDelivery).where(PushDelivery.id == delivery_id, PushDelivery.claim_token == token).values(
                    status="cancelled" if delivery.attempts <= MAX_ATTEMPTS else "failed", claim_token=None,
                ))
                db.commit()
                processed += 1
                continue
            try:
                _send_push(subscription, payload)
            except Exception as exc:
                response = getattr(exc, "response", None)
                status_code = getattr(response, "status_code", None)
                if status_code in (404, 410):
                    # Query deletion relies on CASCADE, preventing stale retries.
                    db.query(PushDelivery).filter_by(subscription_id=subscription.id).delete(synchronize_session=False)
                    db.delete(subscription)
                    logger.info("Push delivery endpoint expired; device registration removed")
                else:
                    retryable = not isinstance(status_code, int) or status_code == 429 or status_code >= 500
                    result = {"last_error_code": f"http_{status_code}" if isinstance(status_code, int) else "transport_error",
                              "claim_token": None}
                    if retryable and delivery.attempts < MAX_ATTEMPTS:
                        result.update(status="queued", next_attempt_at=utcnow() + timedelta(seconds=RETRY_SECONDS[delivery.attempts - 1]))
                    else:
                        result["status"] = "failed"
                    db.execute(update(PushDelivery).where(PushDelivery.id == delivery_id, PushDelivery.claim_token == token).values(**result))
                    logger.warning("Push delivery %s (%s)", result["status"], result["last_error_code"])
            else:
                db.execute(update(PushDelivery).where(PushDelivery.id == delivery_id, PushDelivery.claim_token == token).values(
                    status="sent", sent_at=utcnow(), last_error_code=None, claim_token=None,
                ))
                logger.info("Push notification accepted by provider")
            db.commit()
            processed += 1
    return processed
