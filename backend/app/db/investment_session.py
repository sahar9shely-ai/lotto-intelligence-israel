import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = Path(os.getenv("INVESTMENTS_DB_PATH", str(DATA_DIR / "investments.db")))
SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)


def _normalize_database_url(raw: str) -> str:
    """Accept Neon/Render postgres URLs and force the psycopg driver."""
    url = (raw or "").strip()
    if not url:
        return ""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg" not in url:
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def _resolve_database_url() -> str:
    # Prefer explicit investments URL, then generic DATABASE_URL, else local SQLite.
    for key in ("INVESTMENTS_DATABASE_URL", "DATABASE_URL"):
        normalized = _normalize_database_url(os.getenv(key, ""))
        if normalized:
            return normalized
    return f"sqlite:///{SQLITE_PATH}"


DATABASE_URL = _resolve_database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite:")

_engine_kwargs: dict = {"pool_pre_ping": True}
if IS_SQLITE:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

investment_engine: Engine = create_engine(DATABASE_URL, **_engine_kwargs)


if IS_SQLITE:

    @event.listens_for(investment_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


InvestmentSessionLocal = sessionmaker(
    bind=investment_engine, autoflush=False, autocommit=False
)


def get_investment_db():
    db = InvestmentSessionLocal()
    try:
        yield db
    finally:
        db.close()
