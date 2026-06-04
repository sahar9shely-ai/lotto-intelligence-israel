from __future__ import annotations

import json
from urllib import error, request

from sqlalchemy import text

from app.db.session import SessionLocal


def _post_json(url: str, payload: dict) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url=url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body)
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        return http_err.code, json.loads(body) if body else {}


def _get_json(url: str) -> tuple[int, dict]:
    req = request.Request(url=url, method="GET")
    with request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
        return response.status, json.loads(body)


def run_api_runtime_validation() -> None:
    base_url = "http://127.0.0.1:8000"
    dry_run_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "api-dry-run.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "api-validation",
        "dry_run": True,
        "records": [
            {
                "draw_number": 4001,
                "draw_date": "2025-04-01",
                "source_record_id": "api-2025-04-01-4001",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1500000.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 4002,
                "draw_date": "2025-04-08",
                "source_record_id": "api-2025-04-08-4002",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 50],
                "strong_numbers": [1],
                "jackpot_amount": "1500000.00",
                "currency_code": "ILS",
            },
        ],
    }
    dry_run_status_code, dry_run_body = _post_json(f"{base_url}/api/v1/import/draws", dry_run_payload)

    committed_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "api-committed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "api-validation",
        "dry_run": False,
        "records": [
            {
                "draw_number": 5001,
                "draw_date": "2025-05-01",
                "source_record_id": "api-2025-05-01-5001",
                "source_revision": 1,
                "regular_numbers": [1, 9, 13, 17, 24, 37],
                "strong_numbers": [5],
                "jackpot_amount": "1300000.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 5001,
                "draw_date": "2025-05-01",
                "source_record_id": "api-2025-05-01-5001",
                "source_revision": 2,
                "regular_numbers": [1, 10, 13, 17, 24, 37],
                "strong_numbers": [5],
                "jackpot_amount": "1400000.00",
                "currency_code": "ILS",
            },
        ],
    }
    committed_status_code, committed_body = _post_json(f"{base_url}/api/v1/import/draws", committed_payload)
    health_status_code, health_body = _get_json(f"{base_url}/health")

    with SessionLocal() as db:
        integrity = {
            "bad_current_effective_to": db.execute(
                text("select count(*) from lottery_draws where is_current=true and effective_to_utc is not null")
            ).scalar_one(),
            "multiple_current_per_uid": db.execute(
                text(
                    "select count(*) from (select draw_uid from lottery_draws where is_current=true group by draw_uid having count(*)>1) t"
                )
            ).scalar_one(),
            "broken_supersedes_fk": db.execute(
                text(
                    "select count(*) from lottery_draws ld "
                    "where ld.supersedes_draw_revision_id is not null "
                    "and not exists (select 1 from lottery_draws p where p.draw_revision_id=ld.supersedes_draw_revision_id)"
                )
            ).scalar_one(),
        }

    print(
        json.dumps(
            {
                "dry_run_status_code": dry_run_status_code,
                "dry_run_body": dry_run_body,
                "committed_status_code": committed_status_code,
                "committed_body": committed_body,
                "db_integrity": integrity,
                "health_status_code": health_status_code,
                "health_body": health_body,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run_api_runtime_validation()

