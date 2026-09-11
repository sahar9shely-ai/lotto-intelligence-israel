from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.auth import ActivityEvent, User
from app.models.investments import utcnow

# Filter groups for the tracking hub (prefix match on kind).
ACTIVITY_GROUPS: dict[str, tuple[str, ...]] = {
    "login": ("login",),
    "payment": ("payment",),
    "quote": ("quote",),
    "topup": ("topup",),
    "user": ("user", "password"),
    "plan": ("plan",),
    "savings": ("savings",),
    "settings": ("settings",),
    "investor": ("investor",),
}


def _group_clause(group: Optional[str]):
    if not group:
        return None
    prefixes = ACTIVITY_GROUPS.get(group)
    if not prefixes:
        return ActivityEvent.kind == group
    if len(prefixes) == 1:
        return ActivityEvent.kind.like(f"{prefixes[0]}%")
    return or_(*[ActivityEvent.kind.like(f"{p}%") for p in prefixes])


def log_activity(
    db: Session,
    *,
    kind: str,
    title: str,
    body: str = "",
    severity: str = "info",
    actor: Optional[User] = None,
    actor_name: Optional[str] = None,
    investor_id: Optional[int] = None,
    investor_name: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    href: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
    commit: bool = False,
) -> ActivityEvent:
    """Record a tracked event for the manager notification center."""
    name = actor_name
    if name is None and actor is not None:
        name = (
            actor.investor.name
            if getattr(actor, "investor", None) is not None
            else actor.username
        )
    inv_id = investor_id
    if inv_id is None and actor is not None:
        inv_id = actor.investor_id
    inv_name = investor_name
    if inv_name is None and actor is not None and getattr(actor, "investor", None) is not None:
        inv_name = actor.investor.name

    event = ActivityEvent(
        kind=kind,
        title=title[:200],
        body=(body or "")[:500],
        severity=severity if severity in {"info", "success", "warning", "urgent"} else "info",
        actor_user_id=actor.id if actor else None,
        actor_name=(name or None),
        investor_id=inv_id,
        investor_name=inv_name,
        entity_type=entity_type,
        entity_id=entity_id,
        href=href,
        meta_json=json.dumps(meta, ensure_ascii=False) if meta else None,
        created_at=utcnow(),
    )
    db.add(event)
    db.flush()
    if commit:
        db.commit()
        db.refresh(event)
    return event


def serialize_activity(event: ActivityEvent) -> dict:
    return {
        "id": event.id,
        "kind": event.kind,
        "title": event.title,
        "body": event.body,
        "severity": event.severity,
        "actor_user_id": event.actor_user_id,
        "actor_name": event.actor_name,
        "investor_id": event.investor_id,
        "investor_name": event.investor_name,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "href": event.href,
        "meta_json": event.meta_json,
        "created_at": event.created_at,
        "read_at": event.read_at,
        "is_unread": event.read_at is None,
    }


def list_activity(
    db: Session,
    *,
    unread_only: bool = False,
    kind: Optional[str] = None,
    group: Optional[str] = None,
    limit: int = 80,
) -> list[ActivityEvent]:
    query = db.query(ActivityEvent).order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
    if unread_only:
        query = query.filter(ActivityEvent.read_at.is_(None))
    if kind:
        query = query.filter(ActivityEvent.kind == kind)
    else:
        clause = _group_clause(group)
        if clause is not None:
            query = query.filter(clause)
    return query.limit(max(1, min(limit, 300))).all()


def activity_summary(db: Session) -> dict:
    unread = db.query(ActivityEvent).filter(ActivityEvent.read_at.is_(None)).count()
    unread_logins = (
        db.query(ActivityEvent)
        .filter(ActivityEvent.read_at.is_(None), ActivityEvent.kind == "login")
        .count()
    )
    latest = (
        db.query(ActivityEvent)
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
        .first()
    )
    latest_login = (
        db.query(ActivityEvent)
        .filter(ActivityEvent.kind == "login")
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
        .first()
    )
    unread_by_group: dict[str, int] = {}
    for name, prefixes in ACTIVITY_GROUPS.items():
        q = db.query(ActivityEvent).filter(ActivityEvent.read_at.is_(None))
        if len(prefixes) == 1:
            q = q.filter(ActivityEvent.kind.like(f"{prefixes[0]}%"))
        else:
            q = q.filter(or_(*[ActivityEvent.kind.like(f"{p}%") for p in prefixes]))
        count = q.count()
        if count:
            unread_by_group[name] = count

    return {
        "unread_count": unread,
        "unread_login_count": unread_logins,
        "unread_by_group": unread_by_group,
        "latest_id": latest.id if latest else 0,
        "latest_login_id": latest_login.id if latest_login else 0,
        "latest": serialize_activity(latest) if latest else None,
        "latest_login": serialize_activity(latest_login) if latest_login else None,
    }


def mark_activity_read(db: Session, event_id: int) -> ActivityEvent:
    event = db.query(ActivityEvent).filter(ActivityEvent.id == event_id).first()
    if not event:
        raise ValueError("התראה לא נמצאה")
    if event.read_at is None:
        event.read_at = utcnow()
        db.commit()
        db.refresh(event)
    return event


def mark_all_activity_read(
    db: Session,
    *,
    kind: Optional[str] = None,
    group: Optional[str] = None,
) -> int:
    query = db.query(ActivityEvent).filter(ActivityEvent.read_at.is_(None))
    if kind:
        query = query.filter(ActivityEvent.kind == kind)
    else:
        clause = _group_clause(group)
        if clause is not None:
            query = query.filter(clause)
    count = query.update({"read_at": utcnow()}, synchronize_session=False)
    db.commit()
    return int(count)
