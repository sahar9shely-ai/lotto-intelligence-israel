"""Israel business-day arithmetic for payment confirmation nudges.

Counts Sunday–Thursday as business days. Friday and Saturday are skipped.
There is no Israeli holiday calendar in this codebase — holidays are treated
as ordinary weekdays (Sun–Thu).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
# Python weekday(): Monday=0 … Sunday=6. Israel weekend = Friday + Saturday.
ISRAEL_WEEKEND = {4, 5}
NUDGE_AFTER_BUSINESS_DAYS = 3


def israel_now() -> datetime:
    return datetime.now(ISRAEL_TZ)


def israel_today(today: date | None = None) -> date:
    return today or israel_now().date()


def as_israel_date(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        stamp = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return stamp.astimezone(ISRAEL_TZ).date()
    return value


def is_israel_business_day(day: date) -> bool:
    return day.weekday() not in ISRAEL_WEEKEND


def add_israel_business_days(start: date, days: int) -> date:
    """Advance `days` Israel business days after `start` (start itself is not counted)."""
    if days <= 0:
        return start
    cursor = start
    added = 0
    while added < days:
        cursor += timedelta(days=1)
        if is_israel_business_day(cursor):
            added += 1
    return cursor


def israel_business_days_elapsed(start: date, today: date | None = None) -> int:
    """Business days strictly after `start`, through `today` inclusive."""
    today = israel_today(today)
    if today <= start:
        return 0
    elapsed = 0
    cursor = start
    while cursor < today:
        cursor += timedelta(days=1)
        if is_israel_business_day(cursor):
            elapsed += 1
    return elapsed


def confirmation_nudge_due(
    requested_at: date | datetime | None,
    *,
    today: date | None = None,
    after_days: int = NUDGE_AFTER_BUSINESS_DAYS,
) -> bool:
    start = as_israel_date(requested_at)
    if start is None:
        return False
    return israel_business_days_elapsed(start, today) >= after_days
