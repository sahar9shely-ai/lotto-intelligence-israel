from __future__ import annotations

from collections.abc import Generator

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
def reset_database(db_session: Session) -> None:
    db_session.execute(
        text(
            "truncate table system_audit_logs, snapshot_import_lineage, number_frequency, pair_frequency, "
            "analytics_snapshots, data_import_rejections, draw_numbers, strong_numbers, lottery_draws, "
            "data_import_logs restart identity cascade"
        )
    )
    db_session.commit()
