from __future__ import annotations

import json
import os
from urllib import error, parse, request

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


def _get_json(url: str, params: dict | None = None) -> tuple[int, dict]:
    if params:
        url = f"{url}?{parse.urlencode(params)}"
    req = request.Request(url=url, method="GET")
    with request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
        return response.status, json.loads(body)


def run_draws_api_runtime_validation() -> None:
    base_url = os.getenv("BASE_URL", "http://127.0.0.1:8000")

    import_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "api-draws-validation-seed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "api-draws-validation",
        "dry_run": False,
        "records": [
            {
                "draw_number": 6101,
                "draw_date": "2025-06-01",
                "source_record_id": "draws-api-seed-6101",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1111111.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 6102,
                "draw_date": "2025-06-08",
                "source_record_id": "draws-api-seed-6102",
                "source_revision": 1,
                "regular_numbers": [7, 8, 9, 10, 11, 12],
                "strong_numbers": [2],
                "jackpot_amount": "2222222.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 6103,
                "draw_date": "2025-06-15",
                "source_record_id": "draws-api-seed-6103",
                "source_revision": 1,
                "regular_numbers": [13, 14, 15, 16, 17, 18],
                "strong_numbers": [3],
                "jackpot_amount": "3333333.00",
                "currency_code": "ILS",
            },
        ],
    }

    import_status_code, import_body = _post_json(f"{base_url}/api/v1/import/draws", import_payload)

    pagination_status, pagination_body = _get_json(
        f"{base_url}/api/v1/draws",
        {"page": 1, "page_size": 2},
    )
    filter_status, filter_body = _get_json(
        f"{base_url}/api/v1/draws",
        {
            "game_code": "IL_LOTTO",
            "game_variant": "main",
            "rule_version": "v1",
            "date_from": "2025-06-08",
            "date_to": "2025-06-15",
        },
    )
    sort_status, sort_body = _get_json(
        f"{base_url}/api/v1/draws",
        {"sort": "draw_number_asc", "page": 1, "page_size": 3},
    )
    health_status, health_body = _get_json(f"{base_url}/health")

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
                "import_regression": {"status_code": import_status_code, "body": import_body},
                "pagination": {"status_code": pagination_status, "body": pagination_body},
                "filter": {"status_code": filter_status, "body": filter_body},
                "sorting": {"status_code": sort_status, "body": sort_body},
                "db_integrity": integrity,
                "health": {"status_code": health_status, "body": health_body},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run_draws_api_runtime_validation()

