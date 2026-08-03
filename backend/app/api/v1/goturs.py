from __future__ import annotations

import hashlib
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/goturs", tags=["goturs"])

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
DATA_FILE = DATA_DIR / "goturs_store.json"
_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def _default_user(email: str, name: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "email": email.lower().strip(),
        "name": name.strip() or "משתמש/ת",
        "level": 1,
        "points": 0,
        "roomsOpened": 0,
        "friends": 0,
        "isPremium": False,
        "referralCode": f"GOTURS{secrets.token_hex(3).upper()}",
        "favorites": [],
        "openedRooms": [],
        "achievements": [],
        "messages": [
            {
                "id": str(uuid.uuid4()),
                "from": "them",
                "text": "היי! איך הייתה החוויה בחדר הרומנטי?",
                "at": _now(),
            }
        ],
    }


def _empty_store() -> dict[str, Any]:
    return {"users": {}, "tokens": {}}


def _load() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        store = _empty_store()
        DATA_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
        return store
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _empty_store()


def _save(store: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "level": user["level"],
        "points": user["points"],
        "roomsOpened": user["roomsOpened"],
        "friends": user["friends"],
        "isPremium": user["isPremium"],
        "referralCode": user["referralCode"],
        "favorites": user.get("favorites", []),
        "openedRooms": user.get("openedRooms", []),
        "achievements": user.get("achievements", []),
    }


class RegisterBody(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=4)
    name: str = Field(min_length=1, max_length=60)


class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=4)


class PatchBody(BaseModel):
    name: str | None = None
    level: int | None = None
    points: int | None = None
    roomsOpened: int | None = None
    friends: int | None = None
    isPremium: bool | None = None
    favorites: list[str] | None = None
    openedRooms: list[str] | None = None
    achievements: list[str] | None = None


class ChatBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


def _auth_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="נדרשת התחברות")
    token = authorization.removeprefix("Bearer ").strip()
    with _LOCK:
        store = _load()
        user_id = store["tokens"].get(token)
        if not user_id or user_id not in store["users"]:
            raise HTTPException(status_code=401, detail="ההתחברות פגה")
        return store["users"][user_id]


def _normalize_email(email: str) -> str:
    value = email.lower().strip()
    if "@" not in value or "." not in value.split("@")[-1]:
        raise HTTPException(status_code=400, detail="אימייל לא תקין")
    return value


@router.post("/register")
def register(body: RegisterBody) -> dict[str, Any]:
    email = _normalize_email(body.email)
    with _LOCK:
        store = _load()
        for user in store["users"].values():
            if user["email"] == email:
                raise HTTPException(status_code=400, detail="האימייל כבר רשום")
        salt = secrets.token_hex(8)
        user = _default_user(email, body.name)
        user["passwordSalt"] = salt
        user["passwordHash"] = _hash_password(body.password, salt)
        store["users"][user["id"]] = user
        token = secrets.token_urlsafe(24)
        store["tokens"][token] = user["id"]
        _save(store)
    return {"token": token, "user": _public_user(user)}


@router.post("/login")
def login(body: LoginBody) -> dict[str, Any]:
    email = _normalize_email(body.email)
    with _LOCK:
        store = _load()
        user = next((u for u in store["users"].values() if u["email"] == email), None)
        if not user:
            raise HTTPException(status_code=401, detail="אימייל או סיסמה שגויים")
        expected = _hash_password(body.password, user["passwordSalt"])
        if expected != user["passwordHash"]:
            raise HTTPException(status_code=401, detail="אימייל או סיסמה שגויים")
        token = secrets.token_urlsafe(24)
        store["tokens"][token] = user["id"]
        _save(store)
    return {"token": token, "user": _public_user(user)}


@router.get("/me")
def me(user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    return _public_user(user)


@router.patch("/me")
def patch_me(
    body: PatchBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="נדרשת התחברות")
    token = authorization.removeprefix("Bearer ").strip()
    data = body.model_dump(exclude_none=True)
    with _LOCK:
        store = _load()
        user_id = store["tokens"].get(token)
        if not user_id or user_id not in store["users"]:
            raise HTTPException(status_code=401, detail="ההתחברות פגה")
        user = store["users"][user_id]
        user.update(data)
        store["users"][user_id] = user
        _save(store)
        return _public_user(user)


@router.get("/chat")
def get_chat(user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    return {"messages": user.get("messages", [])}


@router.post("/chat")
def post_chat(
    body: ChatBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="נדרשת התחברות")
    token = authorization.removeprefix("Bearer ").strip()
    with _LOCK:
        store = _load()
        user_id = store["tokens"].get(token)
        if not user_id or user_id not in store["users"]:
            raise HTTPException(status_code=401, detail="ההתחברות פגה")
        user = store["users"][user_id]
        messages = list(user.get("messages", []))
        messages.append(
            {
                "id": str(uuid.uuid4()),
                "from": "me",
                "text": body.text.strip(),
                "at": _now(),
            }
        )
        messages.append(
            {
                "id": str(uuid.uuid4()),
                "from": "them",
                "text": "קיבלתי 💜 נתראה בחדר",
                "at": _now(),
            }
        )
        user["messages"] = messages[-50:]
        user["points"] = int(user.get("points", 0)) + 30
        store["users"][user_id] = user
        _save(store)
        return {"messages": user["messages"]}
