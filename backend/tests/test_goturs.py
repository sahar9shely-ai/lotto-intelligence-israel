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
