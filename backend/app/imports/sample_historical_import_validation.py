from __future__ import annotations

import json

from app.db.session import SessionLocal
from app.schemas.import_pipeline import ImportBatchRequest
from app.services.historical_import_service import HistoricalDataImportService


def run_sample_validation() -> None:
    sample = ImportBatchRequest(
        source_system="official_israeli_lotto",
        source_object="sample-historical-dataset.json",
        game_code="IL_LOTTO",
        game_variant="main",
        rule_version="v1",
        triggered_by="pipeline-validation",
        dry_run=True,
        records=[
            {
                "draw_number": 1001,
                "draw_date": "2025-01-07",
                "source_record_id": "il-lotto-2025-01-07-1001",
                "source_revision": 1,
                "regular_numbers": [3, 8, 14, 22, 31, 35],
                "strong_numbers": [4],
                "jackpot_amount": "1200000.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 1002,
                "draw_date": "2025-01-14",
                "source_record_id": "il-lotto-2025-01-14-1002",
                "source_revision": 1,
                "regular_numbers": [2, 7, 12, 20, 25, 38],
                "strong_numbers": [6],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            },
        ],
    )

    with SessionLocal() as db:
        service = HistoricalDataImportService(db)
        result = service.run_batch_import(sample)
        print(json.dumps(result.model_dump(mode="json"), indent=2, default=str))


if __name__ == "__main__":
    run_sample_validation()

