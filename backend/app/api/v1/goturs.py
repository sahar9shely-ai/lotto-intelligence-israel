from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/goturs", tags=["goturs"])

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
DATA_FILE = DATA_DIR / "goturs_store.json"
_LOCK = threading.Lock()

# Merchant phone for Bit P2P / payment-request style demos.
# Replace with real Bit Business / Tranzila credentials in production.
BIT_MERCHANT_PHONE = os.getenv("GOTURS_BIT_PHONE", "0528012311")
BIT_MERCHANT_NAME = os.getenv("GOTURS_BIT_NAME", "GOT URS")
BIT_MODE = os.getenv("GOTURS_BIT_MODE", "demo")  # demo | live

ROOM_PRICES = {
    "romantic-1": 149,
    "pamper-1": 179,
    "party-1": 159,
    "games-1": 139,
    "cinema-1": 129,
    "vacation-1": 189,
    "gourmet-1": 219,
    "luxury-1": 299,
}

PREMIUM_PRICES = {
    "premium-month": 49.9,
    "premium-year": 399.0,
}


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
        "phone": "",
        "referralCode": f"GOTURS{secrets.token_hex(3).upper()}",
        "favorites": [],
        "openedRooms": [],
        "achievements": [],
        "orders": [],
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
    return {
        "users": {},
        "tokens": {},
        "payments": {},
        "community": {"messages": [], "presence": {}},
    }


def _load() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        store = _empty_store()
        DATA_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
        return store
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _empty_store()
    data.setdefault("users", {})
    data.setdefault("tokens", {})
    data.setdefault("payments", {})
    data.setdefault("community", {"messages": [], "presence": {}})
    data["community"].setdefault("messages", [])
    data["community"].setdefault("presence", {})
    return data


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
        "phone": user.get("phone", ""),
        "referralCode": user["referralCode"],
        "favorites": user.get("favorites", []),
        "openedRooms": user.get("openedRooms", []),
        "achievements": user.get("achievements", []),
        "orders": user.get("orders", []),
    }


def _public_payment(payment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": payment["id"],
        "kind": payment["kind"],
        "itemId": payment["itemId"],
        "title": payment["title"],
        "amountIls": payment["amountIls"],
        "currency": "ILS",
        "status": payment["status"],
        "method": payment["method"],
        "phone": payment.get("phone", ""),
        "bitDeepLink": payment.get("bitDeepLink"),
        "bitFallbackUrl": payment.get("bitFallbackUrl"),
        "bitQrPayload": payment.get("bitQrPayload"),
        "merchantName": payment.get("merchantName", BIT_MERCHANT_NAME),
        "merchantPhone": payment.get("merchantPhone", BIT_MERCHANT_PHONE),
        "mode": payment.get("mode", BIT_MODE),
        "createdAt": payment["createdAt"],
        "paidAt": payment.get("paidAt"),
    }


def _normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("972"):
        digits = "0" + digits[3:]
    if not re.fullmatch(r"05\d{8}", digits):
        raise HTTPException(status_code=400, detail="מספר טלפון ישראלי לא תקין")
    return digits


def _resolve_amount(kind: str, item_id: str) -> tuple[float, str]:
    if kind == "room":
        if item_id not in ROOM_PRICES:
            raise HTTPException(status_code=404, detail="חדר לא נמצא")
        titles = {
            "romantic-1": "חדר רומנטי",
            "pamper-1": "חדר פינוק",
            "party-1": "חדר מסיבה",
            "games-1": "חדר משחקים",
            "cinema-1": "חדר קולנוע",
            "vacation-1": "חדר חופשה",
            "gourmet-1": "חדר אוכל גורמה",
            "luxury-1": "חדר יוקרתי",
        }
        return float(ROOM_PRICES[item_id]), titles.get(item_id, "חוויית חדר")
    if kind == "premium":
        if item_id not in PREMIUM_PRICES:
            raise HTTPException(status_code=404, detail="חבילת פרימיום לא נמצאה")
        title = "פרימיום חודשי" if item_id == "premium-month" else "פרימיום שנתי"
        return float(PREMIUM_PRICES[item_id]), title
    raise HTTPException(status_code=400, detail="סוג תשלום לא נתמך")


def _bit_links(amount: float, phone: str, payment_id: str, title: str) -> dict[str, str]:
    # Bit has no public consumer P2P API; merchant flows go through gateways (Tranzila/Hyp).
    # We generate practical mobile deep-links + a QR payload merchants can replace with live Bit init URLs.
    amount_str = f"{amount:.2f}".rstrip("0").rstrip(".")
    note = quote(f"GOT URS | {title} | {payment_id}")
    merchant = quote(BIT_MERCHANT_PHONE)
    customer = quote(phone)
    deep = (
        f"bit://payment?phone={merchant}&amount={amount_str}&description={note}"
    )
    fallback = (
        "https://www.bitpay.co.il/"
        f"?phone={BIT_MERCHANT_PHONE}&amount={amount_str}&note={note}&payer={customer}"
    )
    qr_payload = (
        f"BIT|GOTURS|{payment_id}|{amount_str}|ILS|{BIT_MERCHANT_PHONE}|{phone}"
    )
    return {
        "bitDeepLink": deep,
        "bitFallbackUrl": fallback,
        "bitQrPayload": qr_payload,
    }


def _apply_payment_entitlements(user: dict[str, Any], payment: dict[str, Any]) -> None:
    order = {
        "id": payment["id"],
        "kind": payment["kind"],
        "itemId": payment["itemId"],
        "title": payment["title"],
        "amountIls": payment["amountIls"],
        "method": "bit",
        "paidAt": payment.get("paidAt") or _now(),
    }
    orders = list(user.get("orders", []))
    if not any(o.get("id") == order["id"] for o in orders):
        orders.insert(0, order)
    user["orders"] = orders[:30]

    if payment["kind"] == "premium":
        user["isPremium"] = True
        user["points"] = int(user.get("points", 0)) + 200
    elif payment["kind"] == "room":
        room_id = payment["itemId"]
        opened = list(user.get("openedRooms", []))
        if room_id not in opened:
            opened.append(room_id)
            user["roomsOpened"] = int(user.get("roomsOpened", 0)) + 1
            user["points"] = int(user.get("points", 0)) + 100
        user["openedRooms"] = opened
        achievements = list(user.get("achievements", []))
        if user["roomsOpened"] >= 1 and "lover" not in achievements:
            achievements.append("lover")
        if user["roomsOpened"] >= 5 and "explorer" not in achievements:
            achievements.append("explorer")
        if int(user.get("points", 0)) >= 2500 and "legend" not in achievements:
            achievements.append("legend")
        user["achievements"] = achievements
        user["level"] = max(1, int(user.get("points", 0)) // 500 + 1)


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
    phone: str | None = None
    favorites: list[str] | None = None
    openedRooms: list[str] | None = None
    achievements: list[str] | None = None
    orders: list[dict[str, Any]] | None = None


class ChatBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class CommunityPostBody(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    guestId: str | None = Field(default=None, max_length=80)
    guestName: str | None = Field(default=None, max_length=40)


class PresenceBody(BaseModel):
    guestId: str | None = Field(default=None, max_length=80)
    guestName: str | None = Field(default=None, max_length=40)


class BotChatBody(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    history: list[dict[str, str]] | None = None


ONLINE_WINDOW_SEC = 45

ROOM_BOT_CATALOG = [
    {
        "id": "romantic-1",
        "title": "חדר רומנטי",
        "keywords": ["רומנטי", "זוגי", "אהבה", "דייט", "romantic"],
        "price": 149,
        "pitch": "מושלם לערב זוגי עם נרות ואווירה חמה",
    },
    {
        "id": "pamper-1",
        "title": "חדר פינוק",
        "keywords": ["פינוק", "ספא", "ג'קוזי", "רגיעה", "spa"],
        "price": 179,
        "pitch": "למי שרוצה להירגע ולהתפנק עד הסוף",
    },
    {
        "id": "party-1",
        "title": "חדר מסיבה",
        "keywords": ["מסיבה", "מסיבה", "מוזיקה", "אנרגיה", "party"],
        "price": 159,
        "pitch": "אורות, מוזיקה ואדרנלין",
    },
    {
        "id": "games-1",
        "title": "חדר משחקים",
        "keywords": ["משחק", "משחקים", "חידה", "תפקידים"],
        "price": 139,
        "pitch": "לשחק, לגלות ולהתחבר מחדש",
    },
    {
        "id": "cinema-1",
        "title": "חדר קולנוע",
        "keywords": ["קולנוע", "סרט", "נטפליקס", "cinema"],
        "price": 129,
        "pitch": "חוויית מסך ביתית עם הפתעות",
    },
    {
        "id": "vacation-1",
        "title": "חדר חופשה",
        "keywords": ["חופשה", "ים", "בריחה", "vacation"],
        "price": 189,
        "pitch": "תחושת חופש בלי לצאת מהעיר",
    },
]


def _parse_iso(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def _online_users(presence: dict[str, Any]) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    online: list[dict[str, Any]] = []
    for user_id, meta in presence.items():
        last = _parse_iso(str(meta.get("lastSeen", "")))
        if (now - last).total_seconds() <= ONLINE_WINDOW_SEC:
            online.append(
                {
                    "id": user_id,
                    "name": meta.get("name") or "אורח/ת",
                    "isBot": False,
                }
            )
    online.sort(key=lambda u: u["name"])
    return online


def _touch_presence(
    store: dict[str, Any],
    *,
    user_id: str,
    name: str,
) -> None:
    store["community"]["presence"][user_id] = {
        "name": name.strip() or "אורח/ת",
        "lastSeen": _now(),
    }


def _actor_from_store(
    store: dict[str, Any],
    authorization: str | None,
    guest_id: str | None,
    guest_name: str | None,
) -> tuple[str, str]:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        user_id = store["tokens"].get(token)
        if not user_id or user_id not in store["users"]:
            raise HTTPException(status_code=401, detail="ההתחברות פגה")
        user = store["users"][user_id]
        return user_id, str(user.get("name") or "משתמש/ת")
    gid = (guest_id or "").strip() or f"guest_{secrets.token_hex(4)}"
    gname = (guest_name or "").strip() or "אורח/ת"
    return gid, gname[:40]


def _bot_reply(text: str) -> dict[str, Any]:
    lowered = text.strip().lower()
    suggestions: list[dict[str, Any]] = []

    if any(k in lowered for k in ["היי", "שלום", "הי", "בוקר", "ערב", "hello", "hi"]):
        reply = (
            "היי, אני העוזרת של GOT URS 💜\n"
            "ספרי לי איזה מצב רוח יש לך — רומנטי, פינוק, מסיבה, משחקים, קולנוע או חופשה — "
            "ואכוון אותך לסגירת חדר בביט."
        )
        suggestions = [
            {"label": "רומנטי", "path": "/app/pay?kind=room&item=romantic-1"},
            {"label": "הפתיעו אותי", "path": "/app/surprise"},
            {"label": "פרימיום", "path": "/app/pay?kind=premium&item=premium-month"},
        ]
        return {"reply": reply, "suggestions": suggestions}

    if any(k in lowered for k in ["פרימיום", "premium", "מנוי"]):
        reply = (
            "פרימיום פותח חדרים בלעדיים ומוריד הגבלות.\n"
            f"חודשי: ₪{PREMIUM_PRICES['premium-month']} · שנתי: ₪{PREMIUM_PRICES['premium-year']}.\n"
            "רוצה לסגור עכשיו בביט?"
        )
        suggestions = [
            {"label": "פרימיום חודשי בביט", "path": "/app/pay?kind=premium&item=premium-month"},
            {"label": "פרימיום שנתי בביט", "path": "/app/pay?kind=premium&item=premium-year"},
        ]
        return {"reply": reply, "suggestions": suggestions}

    if any(k in lowered for k in ["הפתעה", "הפתיע", "רנדום", "לא יודע", "תבחרי", "surprise"]):
        reply = (
            "אוהבת את זה! בואי נלך על הפתעה — אני אכוון אותך לחדר שמתאים לרגע.\n"
            "אפשר גם לבחור ידנית אם תרצי שליטה מלאה."
        )
        suggestions = [
            {"label": "הפתיעי אותי", "path": "/app/surprise"},
            {"label": "בחירה ידנית", "path": "/app/manual"},
        ]
        return {"reply": reply, "suggestions": suggestions}

    matched = None
    for room in ROOM_BOT_CATALOG:
        if any(k in lowered for k in room["keywords"]):
            matched = room
            break

    if matched:
        reply = (
            f"מצאתי התאמה: {matched['title']} ✨\n"
            f"{matched['pitch']}.\n"
            f"מחיר: ₪{matched['price']} · תשלום בביט ל־{BIT_MERCHANT_PHONE}.\n"
            "לחצי למטה כדי לסגור עכשיו."
        )
        suggestions = [
            {
                "label": f"סגרו {matched['title']} בביט",
                "path": f"/app/pay?kind=room&item={matched['id']}",
            },
            {"label": "עוד אפשרויות", "path": "/app/discover"},
        ]
        return {"reply": reply, "suggestions": suggestions}

    if any(k in lowered for k in ["מחיר", "כמה", "עלות", "payment", "ביט"]):
        reply = (
            "התשלום בביט עובר ישירות ל־0528012311.\n"
            "חדרים מ־₪129 ועד ₪299. פרימיום חודשי ₪49.9.\n"
            "מה בא לך לסגור?"
        )
        suggestions = [
            {"label": "חדר רומנטי", "path": "/app/pay?kind=room&item=romantic-1"},
            {"label": "חדר פינוק", "path": "/app/pay?kind=room&item=pamper-1"},
            {"label": "פרימיום", "path": "/app/pay?kind=premium&item=premium-month"},
        ]
        return {"reply": reply, "suggestions": suggestions}

    reply = (
        "אני כאן כדי לעזור לך לסגור חדר 💫\n"
        "כתבי למשל: רומנטי / פינוק / מסיבה / משחקים / קולנוע / חופשה / הפתעה / פרימיום."
    )
    suggestions = [
        {"label": "רומנטי", "path": "/app/pay?kind=room&item=romantic-1"},
        {"label": "פינוק", "path": "/app/pay?kind=room&item=pamper-1"},
        {"label": "הפתעה", "path": "/app/surprise"},
    ]
    return {"reply": reply, "suggestions": suggestions}


class CreatePaymentBody(BaseModel):
    kind: str = Field(pattern="^(room|premium)$")
    itemId: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=9, max_length=20)


class ConfirmPaymentBody(BaseModel):
    paymentId: str = Field(min_length=8, max_length=80)


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
    if "phone" in data and data["phone"]:
        data["phone"] = _normalize_phone(str(data["phone"]))
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


@router.post("/community/presence")
def community_presence(
    body: PresenceBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    with _LOCK:
        store = _load()
        user_id, name = _actor_from_store(
            store, authorization, body.guestId, body.guestName
        )
        _touch_presence(store, user_id=user_id, name=name)
        now = datetime.now(timezone.utc)
        fresh = {}
        for pid, meta in store["community"]["presence"].items():
            last = _parse_iso(str(meta.get("lastSeen", "")))
            if (now - last).total_seconds() <= ONLINE_WINDOW_SEC * 4:
                fresh[pid] = meta
        store["community"]["presence"] = fresh
        _save(store)
        online = _online_users(store["community"]["presence"])
    return {"online": online, "onlineCount": len(online), "selfId": user_id}


@router.get("/community")
def get_community(
    authorization: str | None = Header(default=None),
    guestId: str | None = None,
    guestName: str | None = None,
) -> dict[str, Any]:
    with _LOCK:
        store = _load()
        user_id, name = _actor_from_store(store, authorization, guestId, guestName)
        _touch_presence(store, user_id=user_id, name=name)
        _save(store)
        messages = list(store["community"].get("messages", []))[-100:]
        online = _online_users(store["community"]["presence"])
    return {
        "messages": messages,
        "online": online,
        "onlineCount": len(online),
        "selfId": user_id,
    }


@router.post("/community/messages")
def post_community_message(
    body: CommunityPostBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="הודעה ריקה")
    with _LOCK:
        store = _load()
        user_id, name = _actor_from_store(
            store, authorization, body.guestId, body.guestName
        )
        _touch_presence(store, user_id=user_id, name=name)
        message = {
            "id": str(uuid.uuid4()),
            "userId": user_id,
            "name": name,
            "text": text,
            "at": _now(),
            "kind": "user",
        }
        messages = list(store["community"].get("messages", []))
        messages.append(message)
        store["community"]["messages"] = messages[-200:]
        _save(store)
        online = _online_users(store["community"]["presence"])
        out_messages = list(store["community"]["messages"])[-100:]
    return {
        "messages": out_messages,
        "online": online,
        "onlineCount": len(online),
        "selfId": user_id,
    }


@router.post("/bot/chat")
def bot_chat(body: BotChatBody) -> dict[str, Any]:
    result = _bot_reply(body.text)
    return {
        "id": str(uuid.uuid4()),
        "role": "bot",
        "text": result["reply"],
        "suggestions": result["suggestions"],
        "at": _now(),
    }


@router.get("/catalog/prices")
def catalog_prices() -> dict[str, Any]:
    return {
        "rooms": ROOM_PRICES,
        "premium": PREMIUM_PRICES,
        "currency": "ILS",
        "bitMode": BIT_MODE,
        "merchantName": BIT_MERCHANT_NAME,
    }


@router.post("/payments/bit")
def create_bit_payment(
    body: CreatePaymentBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    phone = _normalize_phone(body.phone)
    amount, title = _resolve_amount(body.kind, body.itemId)
    payment_id = f"pay_{secrets.token_hex(8)}"
    links = _bit_links(amount, phone, payment_id, title)

    guest = False
    user_id: str | None = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        with _LOCK:
            store = _load()
            user_id = store["tokens"].get(token)
            if not user_id or user_id not in store["users"]:
                raise HTTPException(status_code=401, detail="ההתחברות פגה")
            store["users"][user_id]["phone"] = phone
    else:
        guest = True

    payment = {
        "id": payment_id,
        "userId": user_id,
        "guest": guest,
        "kind": body.kind,
        "itemId": body.itemId,
        "title": title,
        "amountIls": amount,
        "status": "pending",
        "method": "bit",
        "phone": phone,
        "merchantName": BIT_MERCHANT_NAME,
        "merchantPhone": BIT_MERCHANT_PHONE,
        "mode": BIT_MODE,
        "createdAt": _now(),
        "paidAt": None,
        **links,
    }

    with _LOCK:
        store = _load()
        store["payments"][payment_id] = payment
        if user_id and user_id in store["users"]:
            store["users"][user_id]["phone"] = phone
        _save(store)

    return _public_payment(payment)


@router.get("/payments/{payment_id}")
def get_payment(payment_id: str) -> dict[str, Any]:
    with _LOCK:
        store = _load()
        payment = store["payments"].get(payment_id)
        if not payment:
            raise HTTPException(status_code=404, detail="תשלום לא נמצא")
        return _public_payment(payment)


@router.post("/payments/bit/confirm")
def confirm_bit_payment(
    body: ConfirmPaymentBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Demo/confirm endpoint.
    In live mode this should be replaced by Bit/Tranzila/Hyp webhooks (notify_url).
    """
    with _LOCK:
        store = _load()
        payment = store["payments"].get(body.paymentId)
        if not payment:
            raise HTTPException(status_code=404, detail="תשלום לא נמצא")

        if payment["status"] != "paid":
            payment["status"] = "paid"
            payment["paidAt"] = _now()
            store["payments"][body.paymentId] = payment

            user = None
            if authorization and authorization.startswith("Bearer "):
                token = authorization.removeprefix("Bearer ").strip()
                user_id = store["tokens"].get(token)
                if user_id and user_id in store["users"]:
                    user = store["users"][user_id]
            elif payment.get("userId") and payment["userId"] in store["users"]:
                user = store["users"][payment["userId"]]

            if user is not None:
                _apply_payment_entitlements(user, payment)
                store["users"][user["id"]] = user

            _save(store)
            return {
                "payment": _public_payment(payment),
                "user": _public_user(user) if user else None,
            }

        user = None
        if payment.get("userId") and payment["userId"] in store["users"]:
            user = store["users"][payment["userId"]]
        return {
            "payment": _public_payment(payment),
            "user": _public_user(user) if user else None,
        }
