from __future__ import annotations

"""Lightweight schema patches for evolving investment/auth tables (SQLite + Postgres)."""

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db.investment_base import InvestmentBase


def _dialect(engine: Engine) -> str:
    return engine.dialect.name


def _table_columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        if _dialect(engine) == "sqlite":
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            return {row[1] for row in rows}
        rows = conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = :t
                """
            ),
            {"t": table},
        ).fetchall()
    return {row[0] for row in rows}


def _table_exists(engine: Engine, table: str) -> bool:
    with engine.connect() as conn:
        if _dialect(engine) == "sqlite":
            row = conn.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=:n"
                ),
                {"n": table},
            ).fetchone()
            return row is not None
        row = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = :n
                """
            ),
            {"n": table},
        ).fetchone()
    return row is not None


def _add_column(conn, table: str, column_sql: str) -> None:
    """column_sql example: 'plan_type VARCHAR(32) DEFAULT \\'monthly\\''"""
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_sql}"))


def ensure_schema(engine: Engine) -> None:
    # Ensure model tables (including savings_actions) are registered.
    from app.models import investments as _investment_models  # noqa: F401
    from app.models import auth as _auth_models  # noqa: F401

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
                _add_column(conn, table, "plan_type VARCHAR(32) DEFAULT 'monthly'")
                conn.execute(
                    text(
                        f"UPDATE {table} SET plan_type = 'monthly' "
                        "WHERE plan_type IS NULL OR plan_type = ''"
                    )
                )
            if "savings_rate_percent" not in cols:
                _add_column(conn, table, "savings_rate_percent FLOAT DEFAULT 0")
                conn.execute(
                    text(
                        f"UPDATE {table} SET savings_rate_percent = 0 "
                        "WHERE savings_rate_percent IS NULL"
                    )
                )

    if _table_exists(engine, "quotes"):
        cols = _table_columns(engine, "quotes")
        with engine.begin() as conn:
            if "phone" not in cols:
                _add_column(conn, "quotes", "phone VARCHAR(40)")
            if "access_username" not in cols:
                _add_column(conn, "quotes", "access_username VARCHAR(64)")
            if "access_password" not in cols:
                _add_column(conn, "quotes", "access_password VARCHAR(128)")
            if "start_date" not in cols:
                _add_column(conn, "quotes", "start_date DATE")
            conn.execute(
                text(
                    """
                    UPDATE quotes SET status = 'pending'
                    WHERE status IN ('draft', 'sent')
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE quotes SET status = 'rejected'
                    WHERE status = 'archived'
                    """
                )
            )

    if _table_exists(engine, "users"):
        cols = _table_columns(engine, "users")
        with engine.begin() as conn:
            if "access_password" not in cols:
                _add_column(conn, "users", "access_password VARCHAR(128)")

    if _table_exists(engine, "users") and _table_exists(engine, "quotes"):
        ucols = _table_columns(engine, "users")
        qcols = _table_columns(engine, "quotes")
        if (
            "access_password" in ucols
            and "access_password" in qcols
            and "converted_investor_id" in qcols
        ):
            with engine.begin() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT converted_investor_id, access_password
                        FROM quotes
                        WHERE converted_investor_id IS NOT NULL
                          AND access_password IS NOT NULL
                          AND access_password != ''
                        ORDER BY id DESC
                        """
                    )
                ).fetchall()
                seen: set[int] = set()
                for inv_id, pwd in rows:
                    if inv_id in seen:
                        continue
                    seen.add(inv_id)
                    conn.execute(
                        text(
                            """
                            UPDATE users
                            SET access_password = :pwd
                            WHERE investor_id = :inv_id
                              AND (access_password IS NULL OR access_password = '')
                            """
                        ),
                        {"pwd": pwd, "inv_id": inv_id},
                    )

    if _table_exists(engine, "app_settings"):
        cols = _table_columns(engine, "app_settings")
        with engine.begin() as conn:
            if "site_updating" not in cols:
                default_bool = "FALSE" if _dialect(engine) != "sqlite" else "0"
                _add_column(
                    conn,
                    "app_settings",
                    f"site_updating BOOLEAN DEFAULT {default_bool}",
                )
                conn.execute(
                    text(
                        "UPDATE app_settings SET site_updating = "
                        f"{default_bool} WHERE site_updating IS NULL"
                    )
                )
            if "site_updating_message" not in cols:
                _add_column(
                    conn,
                    "app_settings",
                    "site_updating_message VARCHAR(240) DEFAULT "
                    "'האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.'",
                )
                conn.execute(
                    text(
                        "UPDATE app_settings SET site_updating_message = "
                        "'האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.' "
                        "WHERE site_updating_message IS NULL OR site_updating_message = ''"
                    )
                )
            if "slack_webhook_url" not in cols:
                _add_column(conn, "app_settings", "slack_webhook_url VARCHAR(500)")
            if "assistant_provider" not in cols:
                _add_column(
                    conn,
                    "app_settings",
                    "assistant_provider VARCHAR(32) DEFAULT 'gemini'",
                )
                conn.execute(
                    text(
                        "UPDATE app_settings SET assistant_provider = 'gemini' "
                        "WHERE assistant_provider IS NULL OR assistant_provider = ''"
                    )
                )
            if "assistant_api_key" not in cols:
                _add_column(conn, "app_settings", "assistant_api_key VARCHAR(200)")
            if "demo_investors_seeded" not in cols:
                default_bool = "FALSE" if _dialect(engine) != "sqlite" else "0"
                _add_column(
                    conn,
                    "app_settings",
                    f"demo_investors_seeded BOOLEAN DEFAULT {default_bool}",
                )
                # Existing DBs already went through seed — never resurrect deleted demos.
                if _table_exists(engine, "investors"):
                    inv_count = conn.execute(text("SELECT COUNT(*) FROM investors")).scalar() or 0
                    if inv_count > 0:
                        true_bool = "TRUE" if _dialect(engine) != "sqlite" else "1"
                        conn.execute(
                            text(
                                f"UPDATE app_settings SET demo_investors_seeded = {true_bool}"
                            )
                        )

    if _table_exists(engine, "investment_plans"):
        cols = _table_columns(engine, "investment_plans")
        with engine.begin() as conn:
            if "accrual_principal" not in cols:
                _add_column(conn, "investment_plans", "accrual_principal FLOAT")
                conn.execute(
                    text(
                        "UPDATE investment_plans SET accrual_principal = principal "
                        "WHERE accrual_principal IS NULL"
                    )
                )
            if "savings_redeemed_total" not in cols:
                _add_column(
                    conn,
                    "investment_plans",
                    "savings_redeemed_total FLOAT DEFAULT 0",
                )
                conn.execute(
                    text(
                        "UPDATE investment_plans SET savings_redeemed_total = 0 "
                        "WHERE savings_redeemed_total IS NULL"
                    )
                )
            if "rollover_savings_balance" not in cols:
                _add_column(
                    conn,
                    "investment_plans",
                    "rollover_savings_balance FLOAT DEFAULT 0",
                )
                conn.execute(
                    text(
                        "UPDATE investment_plans SET rollover_savings_balance = 0 "
                        "WHERE rollover_savings_balance IS NULL"
                    )
                )
            if "successor_plan_id" not in cols:
                _add_column(conn, "investment_plans", "successor_plan_id INTEGER")

    if _table_exists(engine, "investment_topup_requests"):
        cols = _table_columns(engine, "investment_topup_requests")
        with engine.begin() as conn:
            additions = {
                "contract_number": "contract_number VARCHAR(32)",
                "manager_party_name": "manager_party_name VARCHAR(120)",
                "offered_plan_type": "offered_plan_type VARCHAR(32)",
                "offered_duration_months": "offered_duration_months INTEGER",
                "offered_start_date": "offered_start_date DATE",
                "offered_end_date": "offered_end_date DATE",
                "offered_monthly_rate_percent": "offered_monthly_rate_percent FLOAT",
                "offered_savings_rate_percent": "offered_savings_rate_percent FLOAT",
                "offered_management_fee_percent": "offered_management_fee_percent FLOAT",
                "offered_at": "offered_at DATETIME" if _dialect(engine) == "sqlite" else "offered_at TIMESTAMP",
                "offered_by_user_id": "offered_by_user_id INTEGER",
                "offered_notes": "offered_notes TEXT",
                "manager_signed_at": "manager_signed_at DATETIME" if _dialect(engine) == "sqlite" else "manager_signed_at TIMESTAMP",
                "manager_signed_name": "manager_signed_name VARCHAR(80)",
                "manager_signature_png": "manager_signature_png TEXT",
                "investor_signed_at": "investor_signed_at DATETIME" if _dialect(engine) == "sqlite" else "investor_signed_at TIMESTAMP",
                "investor_signed_name": "investor_signed_name VARCHAR(80)",
                "investor_signature_png": "investor_signature_png TEXT",
                "executed_at": "executed_at DATETIME" if _dialect(engine) == "sqlite" else "executed_at TIMESTAMP",
            }
            for name, sql in additions.items():
                if name not in cols:
                    _add_column(conn, "investment_topup_requests", sql)

    if not _table_exists(engine, "users"):
        return

    cols = _table_columns(engine, "users")
    with engine.begin() as conn:
        if "username" not in cols:
            _add_column(conn, "users", "username VARCHAR(64)")
            rows = conn.execute(
                text("SELECT id, email, username FROM users ORDER BY id")
            ).fetchall()
            seen: set[str] = set()
            for uid, email, uname in rows:
                if uname:
                    base = str(uname).lower()
                elif email and "@" in str(email):
                    base = str(email).split("@", 1)[0].lower()
                else:
                    base = f"user{uid}"
                candidate = base or f"user{uid}"
                n = 1
                while candidate in seen:
                    n += 1
                    candidate = f"{base}{n}"
                seen.add(candidate)
                conn.execute(
                    text("UPDATE users SET username = :u WHERE id = :id"),
                    {"u": candidate, "id": uid},
                )

        # Unique index for username (safe if already present)
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username_unique "
                "ON users(username)"
            )
        )
