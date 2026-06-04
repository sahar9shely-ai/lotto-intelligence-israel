from __future__ import annotations

import json
import os
from urllib import error, parse, request
from uuid import uuid4

from app.db.session import SessionLocal
from app.services.statistics_engine_service import StatisticsEngineService


def _post_json(url: str, payload: dict) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url=url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        return http_err.code, json.loads(body) if body else {}


def _get_json(url: str, params: dict | None = None) -> tuple[int, dict]:
    if params:
        url = f"{url}?{parse.urlencode(params)}"
    req = request.Request(url=url, method="GET")
    try:
        with request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        return http_err.code, json.loads(body) if body else {}


def run_smoke() -> None:
    base_url = os.getenv("BASE_URL", "http://127.0.0.1:8004")
    seed_id = str(uuid4())[:8]
    import_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "api-error-smoke-seed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "api-error-smoke",
        "dry_run": False,
        "records": [
            {
                "draw_number": 900000 + int(seed_id[:4], 16),
                "draw_date": "2025-12-01",
                "source_record_id": f"api-error-seed-{seed_id}",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            }
        ],
    }
    import_status, import_body = _post_json(f"{base_url}/api/v1/import/draws", import_payload)

    with SessionLocal() as db:
        stats = StatisticsEngineService(db)
        stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="api-error-smoke",
        )

    params = {
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
    }
    health = _get_json(f"{base_url}/health")
    draws = _get_json(f"{base_url}/api/v1/draws", {"page": 1, "page_size": 1})
    draw_uid = draws[1]["items"][0]["draw_uid"]
    draw_detail = _get_json(f"{base_url}/api/v1/draws/{draw_uid}")

    stats_freq = _get_json(f"{base_url}/api/v1/stats/frequency", params)
    stats_strong = _get_json(f"{base_url}/api/v1/stats/strong-number", params)
    stats_pairs = _get_json(f"{base_url}/api/v1/stats/pairs", params)
    stats_summary = _get_json(f"{base_url}/api/v1/stats/summary", params)

    not_found = _get_json(f"{base_url}/api/v1/draws/{uuid4()}")
    invalid_422 = _post_json(f"{base_url}/api/v1/import/draws", {"invalid": "payload"})

    print(
        json.dumps(
            {
                "health": {"status_code": health[0], "body": health[1]},
                "import": {"status_code": import_status, "body": import_body},
                "draws": {"status_code": draws[0], "body": draws[1]},
                "draw_detail": {"status_code": draw_detail[0], "body": draw_detail[1]},
                "stats": {
                    "frequency": {"status_code": stats_freq[0], "body": stats_freq[1]},
                    "strong": {"status_code": stats_strong[0], "body": stats_strong[1]},
                    "pairs": {"status_code": stats_pairs[0], "body": stats_pairs[1]},
                    "summary": {"status_code": stats_summary[0], "body": stats_summary[1]},
                },
                "not_found_404": {"status_code": not_found[0], "body": not_found[1]},
                "validation_422": {"status_code": invalid_422[0], "body": invalid_422[1]},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run_smoke()

