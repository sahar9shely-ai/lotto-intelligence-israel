from __future__ import annotations

import json

from sqlalchemy import text

from app.db.session import SessionLocal
from datetime import date
from app.schemas.import_pipeline import ImportBatchRequest
from app.services.historical_import_service import HistoricalDataImportService
from app.services.statistics_engine_service import StatisticsEngineService


def run_statistics_validation() -> None:
    with SessionLocal() as db:
        importer = HistoricalDataImportService(db)
        stats = StatisticsEngineService(db)

        seed_payload = ImportBatchRequest(
            source_system="official_israeli_lotto",
            source_object="statistics-seed.json",
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            triggered_by="statistics-validation",
            dry_run=False,
            records=[
                {
                    "draw_number": 8101,
                    "draw_date": "2025-08-01",
                    "source_record_id": "stats-seed-8101",
                    "source_revision": 1,
                    "regular_numbers": [1, 2, 3, 4, 5, 6],
                    "strong_numbers": [1],
                    "jackpot_amount": "1000000.00",
                },
                {
                    "draw_number": 8102,
                    "draw_date": "2025-08-08",
                    "source_record_id": "stats-seed-8102",
                    "source_revision": 1,
                    "regular_numbers": [1, 2, 3, 7, 8, 9],
                    "strong_numbers": [2],
                    "jackpot_amount": "1100000.00",
                },
                {
                    "draw_number": 8103,
                    "draw_date": "2025-08-15",
                    "source_record_id": "stats-seed-8103",
                    "source_revision": 1,
                    "regular_numbers": [1, 2, 10, 11, 12, 13],
                    "strong_numbers": [1],
                    "jackpot_amount": "1200000.00",
                },
            ],
        )
        import_result = importer.run_batch_import(seed_payload)

        snapshot_1 = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="statistics-validation",
        )
        snapshot_2 = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="statistics-validation",
        )

        revision_update_payload = ImportBatchRequest(
            source_system="official_israeli_lotto",
            source_object="statistics-seed-revision.json",
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            triggered_by="statistics-validation",
            dry_run=False,
            records=[
                {
                    "draw_number": 8101,
                    "draw_date": "2025-08-01",
                    "source_record_id": "stats-seed-8101",
                    "source_revision": 2,
                    "regular_numbers": [1, 2, 3, 4, 5, 14],
                    "strong_numbers": [1],
                    "jackpot_amount": "1050000.00",
                }
            ],
        )
        revision_import_result = importer.run_batch_import(revision_update_payload)
        snapshot_3 = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="statistics-validation",
        )

        empty_dataset_error = None
        try:
            stats.generate_snapshot(
                game_code="IL_LOTTO",
                game_variant="main",
                rule_version="v1",
                created_by="statistics-validation",
                date_from=date(2030, 1, 1),
                date_to=date(2030, 12, 31),
            )
        except Exception as exc:
            empty_dataset_error = str(exc)

        number_rows = db.execute(
            text(
                "select number_value, appearance_count, frequency_pct "
                "from number_frequency where snapshot_id=:sid order by number_value"
            ),
            {"sid": snapshot_1.snapshot_id},
        ).all()
        pair_rows = db.execute(
            text(
                "select number_a, number_b, cooccurrence_count, support_pct "
                "from pair_frequency where snapshot_id=:sid order by number_a, number_b"
            ),
            {"sid": snapshot_1.snapshot_id},
        ).all()

        # Validation checkpoints for deterministic expectations:
        # number 1 appears in all 3 draws by presence semantics => 3.
        number_1 = next((r for r in number_rows if r.number_value == 1), None)
        # pair (1,2) appears in all three draws => 3 cooccurrences.
        pair_1_2 = next((r for r in pair_rows if r.number_a == 1 and r.number_b == 2), None)

        number_rows_s3 = db.execute(
            text(
                "select number_value, appearance_count, frequency_pct "
                "from number_frequency where snapshot_id=:sid order by number_value"
            ),
            {"sid": snapshot_3.snapshot_id},
        ).all()
        number_14_s3 = next((r for r in number_rows_s3 if r.number_value == 14), None)
        number_6_s3 = next((r for r in number_rows_s3 if r.number_value == 6), None)

        snapshot_sql = db.execute(
            text(
                "select snapshot_id, snapshot_code, status, dataset_hash_sha256, "
                "window_start_date, window_end_date from analytics_snapshots order by snapshot_id"
            )
        ).all()
        lineage_sql = db.execute(
            text("select snapshot_id, import_id from snapshot_import_lineage order by snapshot_id, import_id")
        ).all()
        audit_sql = db.execute(
            text(
                "select action, result, severity, count(*) as cnt "
                "from system_audit_logs group by action, result, severity order by action"
            )
        ).all()

        integrity_sql = db.execute(
            text(
                "select "
                "(select count(*) from analytics_snapshots where status='published') as published_count, "
                "(select count(*) from number_frequency where appearance_count < 0) as bad_number_counts, "
                "(select count(*) from pair_frequency where cooccurrence_count < 0) as bad_pair_counts, "
                "(select count(*) from pair_frequency where number_a >= number_b) as bad_pair_order"
            )
        ).first()

        print(
            json.dumps(
                {
                    "import_result": import_result.model_dump(mode="json"),
                    "snapshot_1": snapshot_1.__dict__,
                    "snapshot_2": snapshot_2.__dict__,
                    "revision_import_result": revision_import_result.model_dump(mode="json"),
                    "snapshot_3_after_revision": snapshot_3.__dict__,
                    "frequency_check_number_1": {
                        "appearance_count": number_1.appearance_count if number_1 else None,
                        "frequency_pct": str(number_1.frequency_pct) if number_1 else None,
                        "expected_appearance_count": 3,
                    },
                    "pair_check_1_2": {
                        "cooccurrence_count": pair_1_2.cooccurrence_count if pair_1_2 else None,
                        "support_pct": str(pair_1_2.support_pct) if pair_1_2 else None,
                        "expected_cooccurrence_count": 3,
                    },
                    "changed_revision_check": {
                        "snapshot_3_id": snapshot_3.snapshot_id,
                        "snapshot_1_hash": snapshot_1.dataset_hash_sha256,
                        "snapshot_3_hash": snapshot_3.dataset_hash_sha256,
                        "number_14_appearance_count": number_14_s3.appearance_count if number_14_s3 else None,
                        "number_6_exists": number_6_s3 is not None,
                    },
                    "empty_dataset_result": {
                        "error": empty_dataset_error,
                    },
                    "snapshot_rows": [dict(r._mapping) for r in snapshot_sql],
                    "lineage_rows": [dict(r._mapping) for r in lineage_sql],
                    "audit_rows": [dict(r._mapping) for r in audit_sql],
                    "integrity": dict(integrity_sql._mapping) if integrity_sql else {},
                },
                indent=2,
                default=str,
            )
        )


if __name__ == "__main__":
    run_statistics_validation()

