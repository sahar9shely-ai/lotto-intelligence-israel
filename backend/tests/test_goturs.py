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
