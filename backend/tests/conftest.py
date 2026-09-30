from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from pathlib import Path

_TEST_DIR = tempfile.TemporaryDirectory(prefix="tazrim-investments-pytest-")
_TEST_DB = Path(_TEST_DIR.name) / "investments.db"
os.environ.pop("DATABASE_URL", None)
os.environ.pop("INVESTMENTS_DATABASE_URL", None)
os.environ["INVESTMENTS_DB_PATH"] = str(_TEST_DB)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.main import app
from app.services import investment_service as inv_svc
from app.db.investment_session import InvestmentSessionLocal


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def _seed_investments() -> None:
    # Ensure tables + default investors/users exist for the whole suite.
    with TestClient(app):
        pass
    db = InvestmentSessionLocal()
    try:
        inv_svc.seed_defaults(db)
    finally:
        db.close()


def pytest_sessionfinish(session, exitstatus):
    from app.db.investment_session import investment_engine
    investment_engine.dispose()
    _TEST_DIR.cleanup()


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def reset_database(request: pytest.FixtureRequest) -> None:
    if "db_session" not in request.fixturenames:
        return
    db_session: Session = request.getfixturevalue("db_session")
    try:
        db_session.execute(
            text(
                "truncate table system_audit_logs, snapshot_import_lineage, number_frequency, pair_frequency, "
                "analytics_snapshots, data_import_rejections, draw_numbers, strong_numbers, lottery_draws, "
                "data_import_logs restart identity cascade"
            )
        )
        db_session.commit()
    except Exception:
        db_session.rollback()
