from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

_TEST_DB = Path("/tmp/tazrim-investments-pytest.db")
if _TEST_DB.exists():
    _TEST_DB.unlink()
os.environ["INVESTMENTS_DB_PATH"] = str(_TEST_DB)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.main import app


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


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
