from __future__ import annotations

"""Lightweight SQLite schema patches for evolving investment/auth tables."""

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db.investment_base import InvestmentBase


def _table_columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _table_exists(engine: Engine, table: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": table},
        ).fetchone()
    return row is not None


def ensure_schema(engine: Engine) -> None:
    # Ensure model tables (including savings_actions) are registered.
    from app.models import investments as _investment_models  # noqa: F401

    InvestmentBase.metadata.create_all(bind=engine)

    if _table_exists(engine, "payments"):
        with engine.begin() as conn:
            # Deduplicate before unique indexes (keep lowest id per key).
            conn.execute(
                text(
                    """
                    DELETE FROM payments
                    WHERE id NOT IN (
                      SELECT MIN(id) FROM payments GROUP BY plan_id, month_number
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    DELETE FROM payments
                    WHERE id NOT IN (
                      SELECT MIN(id) FROM payments GROUP BY investor_id, due_date
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_plan_month "
                    "ON payments(plan_id, month_number)"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_investor_due "
                    "ON payments(investor_id, due_date)"
                )
            )

    for table in ("investment_plans", "quotes"):
        if not _table_exists(engine, table):
            continue
        cols = _table_columns(engine, table)
        with engine.begin() as conn:
            if "plan_type" not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN plan_type VARCHAR(32) "
                        "DEFAULT 'monthly'"
                    )
                )
                conn.execute(
                    text(
                        f"UPDATE {table} SET plan_type = 'monthly' "
                        "WHERE plan_type IS NULL OR plan_type = ''"
                    )
                )
            if "savings_rate_percent" not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN savings_rate_percent FLOAT "
                        "DEFAULT 0"
                    )
                )
                conn.execute(
                    text(
                        f"UPDATE {table} SET savings_rate_percent = 0 "
                        "WHERE savings_rate_percent IS NULL"
                    )
                )

    if _table_exists(engine, "app_settings"):
        cols = _table_columns(engine, "app_settings")
        with engine.begin() as conn:
            if "site_updating" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN site_updating BOOLEAN "
                        "DEFAULT 0"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE app_settings SET site_updating = 0 "
                        "WHERE site_updating IS NULL"
                    )
                )
            if "site_updating_message" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN site_updating_message "
                        "VARCHAR(240) DEFAULT "
                        "'האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.'"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE app_settings SET site_updating_message = "
                        "'האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.' "
                        "WHERE site_updating_message IS NULL OR site_updating_message = ''"
                    )
                )
            if "slack_webhook_url" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN slack_webhook_url "
                        "VARCHAR(500)"
                    )
                )
            if "assistant_provider" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN assistant_provider "
                        "VARCHAR(32) DEFAULT 'gemini'"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE app_settings SET assistant_provider = 'gemini' "
                        "WHERE assistant_provider IS NULL OR assistant_provider = ''"
                    )
                )
            if "assistant_api_key" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN assistant_api_key "
                        "VARCHAR(200)"
                    )
                )

    if _table_exists(engine, "investment_plans"):
        cols = _table_columns(engine, "investment_plans")
        with engine.begin() as conn:
            if "accrual_principal" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE investment_plans ADD COLUMN accrual_principal FLOAT"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE investment_plans SET accrual_principal = principal "
                        "WHERE accrual_principal IS NULL"
                    )
                )
            if "savings_redeemed_total" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE investment_plans ADD COLUMN "
                        "savings_redeemed_total FLOAT DEFAULT 0"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE investment_plans SET savings_redeemed_total = 0 "
                        "WHERE savings_redeemed_total IS NULL"
                    )
                )
            if "successor_plan_id" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE investment_plans ADD COLUMN "
                        "successor_plan_id INTEGER"
                    )
                )

    if not _table_exists(engine, "users"):
        return

    cols = _table_columns(engine, "users")
    with engine.begin() as conn:
        if "username" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(64)"))
            # Backfill from email local-part or user id
            conn.execute(
                text(
                    """
                    UPDATE users
                    SET username = lower(
                        CASE
                          WHEN email IS NOT NULL AND instr(email, '@') > 1
                            THEN substr(email, 1, instr(email, '@') - 1)
                          ELSE 'user' || id
                        END
                    )
                    WHERE username IS NULL OR username = ''
                    """
                )
            )
            # Deduplicate usernames if needed
            rows = conn.execute(
                text("SELECT id, username FROM users ORDER BY id")
            ).fetchall()
            seen: set[str] = set()
            for uid, uname in rows:
                base = (uname or f"user{uid}").lower()
                candidate = base
                n = 1
                while candidate in seen:
                    n += 1
                    candidate = f"{base}{n}"
                seen.add(candidate)
                if candidate != uname:
                    conn.execute(
                        text("UPDATE users SET username = :u WHERE id = :id"),
                        {"u": candidate, "id": uid},
                    )

        # Unique index for username (safe if already present)
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username_unique ON users(username)"
            )
        )
