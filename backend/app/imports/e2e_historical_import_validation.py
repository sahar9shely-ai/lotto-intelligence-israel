from __future__ import annotations

import json

from sqlalchemy import text

from app.db.session import SessionLocal
from app.schemas.import_pipeline import ImportBatchRequest
from app.services.historical_import_service import HistoricalDataImportService


def run_e2e_validation() -> None:
    with SessionLocal() as db:
        service = HistoricalDataImportService(db)

        run1 = ImportBatchRequest(
            source_system="official_israeli_lotto",
            source_object="sample-e2e-run-1.json",
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            triggered_by="pipeline-e2e-validation",
            dry_run=False,
            records=[
                {
                    "draw_number": 2001,
                    "draw_date": "2025-02-01",
                    "source_record_id": "il-lotto-2025-02-01-2001",
                    "source_revision": 1,
                    "regular_numbers": [1, 9, 13, 17, 24, 37],
                    "strong_numbers": [5],
                    "jackpot_amount": "1300000.00",
                },
                {
                    "draw_number": 2002,
                    "draw_date": "2025-02-08",
                    "source_record_id": "il-lotto-2025-02-08-2002",
                    "source_revision": 1,
                    "regular_numbers": [2, 7, 12, 20, 25, 40],
                    "strong_numbers": [6],
                    "jackpot_amount": "1100000.00",
                },
            ],
        )
        run1_result = service.run_batch_import(run1)

        run2 = ImportBatchRequest(
            source_system="official_israeli_lotto",
            source_object="sample-e2e-run-2.json",
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            triggered_by="pipeline-e2e-validation",
            dry_run=False,
            records=[
                {
                    "draw_number": 2001,
                    "draw_date": "2025-02-01",
                    "source_record_id": "il-lotto-2025-02-01-2001",
                    "source_revision": 1,
                    "regular_numbers": [1, 9, 13, 17, 24, 37],
                    "strong_numbers": [5],
                    "jackpot_amount": "1300000.00",
                },
                {
                    "draw_number": 2001,
                    "draw_date": "2025-02-01",
                    "source_record_id": "il-lotto-2025-02-01-2001",
                    "source_revision": 2,
                    "regular_numbers": [1, 10, 13, 17, 24, 37],
                    "strong_numbers": [5],
                    "jackpot_amount": "1400000.00",
                },
            ],
        )
        run2_result = service.run_batch_import(run2)

        sql_checks = {
            "import_logs": db.execute(text("select count(*) from data_import_logs")).scalar_one(),
            "rejections": db.execute(text("select count(*) from data_import_rejections")).scalar_one(),
            "draw_revisions": db.execute(text("select count(*) from lottery_draws")).scalar_one(),
            "current_draws": db.execute(
                text("select count(*) from lottery_draws where is_current = true")
            ).scalar_one(),
            "audit_logs": db.execute(text("select count(*) from system_audit_logs")).scalar_one(),
        }

        print(
            json.dumps(
                {
                    "run1": run1_result.model_dump(mode="json"),
                    "run2": run2_result.model_dump(mode="json"),
                    "sql_checks": sql_checks,
                },
                indent=2,
                default=str,
            )
        )


if __name__ == "__main__":
    run_e2e_validation()

