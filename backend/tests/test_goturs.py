from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """GOT URS sync store does not use Postgres."""
    return None


def test_goturs_register_login_and_sync(tmp_path, monkeypatch):
    store_file = tmp_path / "goturs_store.json"
    monkeypatch.setattr("app.api.v1.goturs.DATA_FILE", store_file)
    monkeypatch.setattr("app.api.v1.goturs.DATA_DIR", tmp_path)

    client = TestClient(app)

    register = client.post(
        "/api/v1/goturs/register",
        json={"email": "sahar@example.com", "password": "secret", "name": "סהר"},
    )
    assert register.status_code == 200
    token = register.json()["token"]
    assert register.json()["user"]["name"] == "סהר"

    me = client.get("/api/v1/goturs/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "sahar@example.com"

    patched = client.patch(
        "/api/v1/goturs/me",
        headers={"Authorization": f"Bearer {token}"},
        json={"points": 250, "openedRooms": ["romantic-1"], "roomsOpened": 1},
    )
    assert patched.status_code == 200
    assert patched.json()["points"] == 250
    assert patched.json()["openedRooms"] == ["romantic-1"]

    login = client.post(
        "/api/v1/goturs/login",
        json={"email": "sahar@example.com", "password": "secret"},
    )
    assert login.status_code == 200
    other_token = login.json()["token"]
    synced = client.get(
        "/api/v1/goturs/me",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert synced.status_code == 200
    assert synced.json()["points"] == 250

    chat = client.post(
        "/api/v1/goturs/chat",
        headers={"Authorization": f"Bearer {other_token}"},
        json={"text": "היי מהטלפון השני"},
    )
    assert chat.status_code == 200
    assert any(m["text"] == "היי מהטלפון השני" for m in chat.json()["messages"])


def test_goturs_bit_payment_room_and_premium(tmp_path, monkeypatch):
    store_file = tmp_path / "goturs_store.json"
    monkeypatch.setattr("app.api.v1.goturs.DATA_FILE", store_file)
    monkeypatch.setattr("app.api.v1.goturs.DATA_DIR", tmp_path)

    client = TestClient(app)
    register = client.post(
        "/api/v1/goturs/register",
        json={"email": "bit@example.com", "password": "secret", "name": "סהר"},
    )
    token = register.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    prices = client.get("/api/v1/goturs/catalog/prices")
    assert prices.status_code == 200
    assert prices.json()["rooms"]["romantic-1"] == 149

    create = client.post(
        "/api/v1/goturs/payments/bit",
        headers=headers,
        json={"kind": "room", "itemId": "romantic-1", "phone": "0501234567"},
    )
    assert create.status_code == 200
    payment = create.json()
    assert payment["status"] == "pending"
    assert payment["method"] == "bit"
    assert payment["amountIls"] == 149
    assert payment["bitDeepLink"].startswith("bit://")

    bad_phone = client.post(
        "/api/v1/goturs/payments/bit",
        headers=headers,
        json={"kind": "room", "itemId": "romantic-1", "phone": "050123456"},
    )
    assert bad_phone.status_code == 400

    confirm = client.post(
        "/api/v1/goturs/payments/bit/confirm",
        headers=headers,
        json={"paymentId": payment["id"]},
    )
    assert confirm.status_code == 200
    assert confirm.json()["payment"]["status"] == "paid"
    user = confirm.json()["user"]
    assert "romantic-1" in user["openedRooms"]
    assert user["orders"][0]["method"] == "bit"

    premium = client.post(
        "/api/v1/goturs/payments/bit",
        headers=headers,
        json={"kind": "premium", "itemId": "premium-month", "phone": "0501234567"},
    )
    assert premium.status_code == 200
    confirm_premium = client.post(
        "/api/v1/goturs/payments/bit/confirm",
        headers=headers,
        json={"paymentId": premium.json()["id"]},
    )
    assert confirm_premium.status_code == 200
    assert confirm_premium.json()["user"]["isPremium"] is True


def test_community_live_chat_and_bot(tmp_path, monkeypatch):
    store_file = tmp_path / "goturs_store.json"
    monkeypatch.setattr("app.api.v1.goturs.DATA_FILE", store_file)
    monkeypatch.setattr("app.api.v1.goturs.DATA_DIR", tmp_path)
    client = TestClient(app)

    a = client.post(
        "/api/v1/goturs/register",
        json={"email": "a@example.com", "password": "secret", "name": "אנה"},
    ).json()["token"]
    b = client.post(
        "/api/v1/goturs/register",
        json={"email": "b@example.com", "password": "secret", "name": "בן"},
    ).json()["token"]

    post_a = client.post(
        "/api/v1/goturs/community/messages",
        headers={"Authorization": f"Bearer {a}"},
        json={"text": "היי לכולם מהקהילה"},
    )
    assert post_a.status_code == 200
    assert post_a.json()["onlineCount"] >= 1

    feed_b = client.get(
        "/api/v1/goturs/community",
        headers={"Authorization": f"Bearer {b}"},
    )
    assert feed_b.status_code == 200
    assert any(m["text"] == "היי לכולם מהקהילה" for m in feed_b.json()["messages"])
    names = {u["name"] for u in feed_b.json()["online"]}
    assert "אנה" in names or "בן" in names

    guest = client.post(
        "/api/v1/goturs/community/messages",
        json={"text": "גם אני כאן", "guestId": "guest_x", "guestName": "אורחת"},
    )
    assert guest.status_code == 200
    assert any(m["name"] == "אורחת" for m in guest.json()["messages"])

    bot = client.post("/api/v1/goturs/bot/chat", json={"text": "רומנטי"})
    assert bot.status_code == 200
    assert "רומנטי" in bot.json()["text"]
    assert any("romantic-1" in s["path"] for s in bot.json()["suggestions"])
