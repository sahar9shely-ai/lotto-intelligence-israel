import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = Path(os.getenv("INVESTMENTS_DB_PATH", str(DATA_DIR / "investments.db")))
SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)

investment_engine = create_engine(
    f"sqlite:///{SQLITE_PATH}",
    connect_args={"check_same_thread": False},
)


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
