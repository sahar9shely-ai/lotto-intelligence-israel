from __future__ import annotations

from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.repositories.statistics_repository import StatisticsRepository
from app.services.statistics_engine_service import StatisticsEngineService
from tests.helpers import ensure_phase1_rule, import_payload


def _seed_two_draws(client: TestClient) -> None:
    records = [
        {
            "draw_number": 1001,
            "draw_date": "2025-01-01",
            "source_record_id": "seed-1001",
            "source_revision": 1,
            "regular_numbers": [1, 2, 3, 4, 5, 6],
            "strong_numbers": [1],
            "jackpot_amount": "1000000.00",
            "currency_code": "ILS",
        },
        {
            "draw_number": 1002,
            "draw_date": "2025-01-08",
            "source_record_id": "seed-1002",
            "source_revision": 1,
            "regular_numbers": [1, 2, 7, 8, 9, 10],
            "strong_numbers": [2],
            "jackpot_amount": "1100000.00",
            "currency_code": "ILS",
        },
    ]
    response = client.post("/api/v1/import/draws", json=import_payload(records))
    assert response.status_code == 200
    body = response.json()
    assert body["records_valid"] == 2
    assert body["records_quarantined"] == 0


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "dependencies" in body


def test_import_pipeline_dry_run_rollback(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    payload = import_payload(
        [
            {
                "draw_number": 2001,
                "draw_date": "2025-02-01",
                "source_record_id": "dryrun-2001",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1200000.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 2002,
                "draw_date": "2025-02-08",
                "source_record_id": "dryrun-2002",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 99],
                "strong_numbers": [1],
                "jackpot_amount": "1200000.00",
                "currency_code": "ILS",
            },
        ],
        dry_run=True,
    )
    response = client.post("/api/v1/import/draws", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["import_id"] == 0
    assert body["dry_run"] is True
    assert body["records_valid"] == 1
    assert body["records_quarantined"] == 1
    persisted = db_session.execute(text("select count(*) from lottery_draws")).scalar_one()
    assert persisted == 0


def test_import_pipeline_validation_failure_wrong_source(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    payload = import_payload(
        [
            {
                "draw_number": 2003,
                "draw_date": "2025-02-15",
                "source_record_id": "bad-source",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            }
        ]
    )
    payload["source_system"] = "unofficial_feed"
    response = client.post("/api/v1/import/draws", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["records_valid"] == 0
    assert body["records_quarantined"] == 1
    assert body["outcomes"][0]["rejection_code"] == "SOURCE_NOT_ALLOWED"


def test_import_pipeline_duplicate_and_stale_revision(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)

    duplicate_payload = import_payload(
        [
            {
                "draw_number": 3001,
                "draw_date": "2025-03-01",
                "source_record_id": "dup-3001",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 3001,
                "draw_date": "2025-03-01",
                "source_record_id": "dup-3001",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            },
        ]
    )
    dup_response = client.post("/api/v1/import/draws", json=duplicate_payload)
    assert dup_response.status_code == 200
    dup_body = dup_response.json()
    assert dup_body["records_valid"] == 1
    assert dup_body["records_quarantined"] == 1
    assert dup_body["outcomes"][1]["rejection_code"] == "BATCH_DUPLICATE_RECORD"

    stale_payload = import_payload(
        [
            {
                "draw_number": 1001,
                "draw_date": "2025-01-01",
                "source_record_id": "seed-1001",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            }
        ]
    )
    stale_response = client.post("/api/v1/import/draws", json=stale_payload)
    assert stale_response.status_code == 200
    stale_body = stale_response.json()
    assert stale_body["records_valid"] == 0
    assert stale_body["records_quarantined"] == 1
    assert stale_body["outcomes"][0]["rejection_code"] == "STALE_SOURCE_REVISION"


def test_draws_list_endpoint_pagination_filter_sort(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)

    paged = client.get("/api/v1/draws", params={"page": 1, "page_size": 1})
    assert paged.status_code == 200
    paged_body = paged.json()
    assert paged_body["total_count"] == 2
    assert len(paged_body["items"]) == 1
    assert paged_body["items"][0]["draw_number"] == 1002

    filtered = client.get(
        "/api/v1/draws",
        params={
            "game_code": "IL_LOTTO",
            "game_variant": "main",
            "rule_version": "v1",
            "date_from": "2025-01-08",
            "date_to": "2025-01-08",
        },
    )
    assert filtered.status_code == 200
    filtered_body = filtered.json()
    assert filtered_body["total_count"] == 1
    assert filtered_body["items"][0]["draw_number"] == 1002

    sorted_asc = client.get("/api/v1/draws", params={"sort": "draw_number_asc", "page": 1, "page_size": 10})
    assert sorted_asc.status_code == 200
    sorted_body = sorted_asc.json()
    assert [x["draw_number"] for x in sorted_body["items"]] == [1001, 1002]


def test_draw_detail_endpoint_success_and_not_found(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)

    list_response = client.get("/api/v1/draws", params={"page": 1, "page_size": 1})
    draw_uid = list_response.json()["items"][0]["draw_uid"]

    detail = client.get(f"/api/v1/draws/{draw_uid}")
    assert detail.status_code == 200
    detail_body = detail.json()
    assert detail_body["draw_uid"] == draw_uid
    assert len(detail_body["regular_numbers"]) == 6
    assert len(detail_body["strong_numbers"]) == 1

    missing = client.get(f"/api/v1/draws/{uuid4()}")
    assert missing.status_code == 404
    missing_body = missing.json()
    assert missing_body["error"]["code"] == "DRAW_NOT_FOUND"


def test_snapshot_generation_and_reuse_and_revision_supersession(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)
    with SessionLocal() as stats_db:
        stats = StatisticsEngineService(stats_db)

        snap1 = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="pytest",
        )
        assert snap1.reused_existing is False
        assert snap1.number_frequency_rows > 0
        assert snap1.pair_frequency_rows > 0

        snap2 = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="pytest",
        )
        assert snap2.reused_existing is True
        assert snap2.snapshot_id == snap1.snapshot_id

    revision_payload = import_payload(
        [
            {
                "draw_number": 1001,
                "draw_date": "2025-01-01",
                "source_record_id": "seed-1001",
                "source_revision": 2,
                "regular_numbers": [1, 2, 3, 4, 5, 11],
                "strong_numbers": [1],
                "jackpot_amount": "1300000.00",
                "currency_code": "ILS",
            }
        ]
    )
    revision_response = client.post("/api/v1/import/draws", json=revision_payload)
    assert revision_response.status_code == 200
    assert revision_response.json()["records_valid"] == 1

    with SessionLocal() as stats_db:
        stats = StatisticsEngineService(stats_db)
        snap3 = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="pytest",
        )
        assert snap3.reused_existing is False
        assert snap3.snapshot_id != snap1.snapshot_id
        assert snap3.dataset_hash_sha256 != snap1.dataset_hash_sha256


def test_admin_snapshot_operation_generate_reuse_dry_run_and_change(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)

    payload = {
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "pytest-admin",
    }
    first = client.post("/api/v1/admin/stats/snapshots/generate", json=payload)
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["snapshot_id"] > 0
    assert first_body["reused_existing"] is False
    assert first_body["draw_count"] == 2
    assert first_body["status"] == "published"
    first_snapshot_id = first_body["snapshot_id"]
    first_hash = first_body["dataset_hash_sha256"]

    reuse = client.post("/api/v1/admin/stats/snapshots/generate", json=payload)
    assert reuse.status_code == 200
    reuse_body = reuse.json()
    assert reuse_body["snapshot_id"] == first_snapshot_id
    assert reuse_body["reused_existing"] is True
    assert reuse_body["dataset_hash_sha256"] == first_hash
    assert reuse_body["status"] == "published"

    dry_payload = {
        **payload,
        "dry_run": True,
        "date_from": "2025-01-01",
        "date_to": "2025-01-08",
    }
    dry_run = client.post("/api/v1/admin/stats/snapshots/generate", json=dry_payload)
    assert dry_run.status_code == 200
    dry_body = dry_run.json()
    assert dry_body["snapshot_id"] == 0
    assert dry_body["status"] == "dry_run"

    published_count_before = db_session.execute(text("select count(*) from analytics_snapshots")).scalar_one()
    assert published_count_before == 1

    revision_payload = import_payload(
        [
            {
                "draw_number": 1001,
                "draw_date": "2025-01-01",
                "source_record_id": "seed-1001",
                "source_revision": 2,
                "regular_numbers": [1, 2, 3, 4, 5, 11],
                "strong_numbers": [1],
                "jackpot_amount": "1300000.00",
                "currency_code": "ILS",
            }
        ]
    )
    revision_response = client.post("/api/v1/import/draws", json=revision_payload)
    assert revision_response.status_code == 200
    assert revision_response.json()["records_valid"] == 1

    changed = client.post("/api/v1/admin/stats/snapshots/generate", json=payload)
    assert changed.status_code == 200
    changed_body = changed.json()
    assert changed_body["reused_existing"] is False
    assert changed_body["snapshot_id"] != first_snapshot_id
    assert changed_body["dataset_hash_sha256"] != first_hash
    assert changed_body["status"] == "published"

    published_count_after = db_session.execute(
        text("select count(*) from analytics_snapshots where status='published'")
    ).scalar_one()
    assert published_count_after == 1


def test_statistics_endpoints_frequency_strong_pairs_summary(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)
    with SessionLocal() as stats_db:
        stats = StatisticsEngineService(stats_db)
        stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="pytest",
        )

    params = {
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "date_from": "2025-01-01",
        "date_to": "2025-01-08",
    }
    freq = client.get("/api/v1/stats/frequency", params=params)
    assert freq.status_code == 200
    freq_body = freq.json()
    assert freq_body["items"][0]["number_value"] >= 1
    assert all(float(item["frequency_pct"]) <= 100.0 for item in freq_body["items"])

    strong = client.get("/api/v1/stats/strong-number", params=params)
    assert strong.status_code == 200
    strong_body = strong.json()
    assert [item["strong_value"] for item in strong_body["items"]] == [1, 2]

    pairs = client.get("/api/v1/stats/pairs", params=params)
    assert pairs.status_code == 200
    pairs_body = pairs.json()
    assert all(item["number_a"] < item["number_b"] for item in pairs_body["items"])

    summary = client.get("/api/v1/stats/summary", params=params)
    assert summary.status_code == 200
    summary_body = summary.json()
    assert summary_body["draw_count"] == 2
    assert "dataset_hash_sha256" in summary_body
    assert "lineage_import_ids" in summary_body


def test_stats_endpoint_error_envelope_when_snapshot_missing(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    response = client.get(
        "/api/v1/stats/frequency",
        params={
            "game_code": "IL_LOTTO",
            "game_variant": "main",
            "rule_version": "v1",
            "date_from": "2025-01-01",
            "date_to": "2025-01-08",
        },
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "SNAPSHOT_NOT_FOUND"
    assert "message" in body["error"]


def test_statistics_empty_dataset_failure(db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    with SessionLocal() as stats_db:
        stats = StatisticsEngineService(stats_db)
        try:
            stats.generate_snapshot(
                game_code="IL_LOTTO",
                game_variant="main",
                rule_version="v1",
                created_by="pytest",
                date_from=date(2030, 1, 1),
                date_to=date(2030, 12, 31),
            )
            assert False, "Expected ValueError for empty dataset"
        except ValueError as exc:
            assert "No current draws found" in str(exc)


def test_audit_and_lineage_records_created(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)
    with SessionLocal() as stats_db:
        stats = StatisticsEngineService(stats_db)
        snapshot = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="pytest",
        )

    audit_count = db_session.execute(text("select count(*) from system_audit_logs")).scalar_one()
    lineage_count = db_session.execute(
        text("select count(*) from snapshot_import_lineage where snapshot_id=:sid"),
        {"sid": snapshot.snapshot_id},
    ).scalar_one()
    assert audit_count >= 2  # import + snapshot actions
    assert lineage_count >= 1


def test_api_error_envelope_schema_import_and_draw_detail(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    bad_import = client.post(
        "/api/v1/import/draws",
        json={"invalid": "payload"},
    )
    assert bad_import.status_code == 422

    missing_draw = client.get(f"/api/v1/draws/{uuid4()}")
    assert missing_draw.status_code == 404
    body = missing_draw.json()
    assert "error" in body
    assert "code" in body["error"]
    assert "message" in body["error"]

    bad_snapshot = client.post(
        "/api/v1/admin/stats/snapshots/generate",
        json={
            "game_code": "IL_LOTTO",
            "game_variant": "main",
            "rule_version": "v1",
            "triggered_by": "pytest-admin",
            "date_from": "2025-01-10",
            "date_to": "2025-01-01",
        },
    )
    assert bad_snapshot.status_code == 400
    assert bad_snapshot.json()["error"]["code"] == "INVALID_DATE_RANGE"


def test_db_integrity_after_stats_generation(client: TestClient, db_session: Session) -> None:
    ensure_phase1_rule(db_session)
    _seed_two_draws(client)
    with SessionLocal() as stats_db:
        stats = StatisticsEngineService(stats_db)
        stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="pytest",
        )
    integrity = db_session.execute(
        text(
            "select "
            "(select count(*) from pair_frequency where number_a >= number_b) as bad_pair_order, "
            "(select count(*) from number_frequency where frequency_pct < 0 or frequency_pct > 100) as bad_freq_pct, "
            "(select count(*) from analytics_snapshots where status='published') as published_count"
        )
    ).first()
    assert integrity.bad_pair_order == 0
    assert integrity.bad_freq_pct == 0
    assert integrity.published_count == 1
