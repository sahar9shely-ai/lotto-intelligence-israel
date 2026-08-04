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
    InvestmentBase.metadata.create_all(bind=engine)

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
