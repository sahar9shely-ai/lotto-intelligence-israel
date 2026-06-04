from __future__ import annotations

import json
import os
from urllib import error, parse, request

from sqlalchemy import text

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
        if not body:
            return http_err.code, {}
        try:
            return http_err.code, json.loads(body)
        except Exception:
            return http_err.code, {"raw": body}


def _get_json(url: str, params: dict | None = None) -> tuple[int, dict]:
    if params:
        url = f"{url}?{parse.urlencode(params)}"
    req = request.Request(url=url, method="GET")
    try:
        with request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        if not body:
            return http_err.code, {}
        try:
            return http_err.code, json.loads(body)
        except Exception:
            return http_err.code, {"raw": body}


def run_stats_api_validation() -> None:
    base_url = os.getenv("BASE_URL", "http://127.0.0.1:8000")

    import_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "api-stats-seed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "api-stats-validation",
        "dry_run": False,
        "records": [
            {
                "draw_number": 9101,
                "draw_date": "2025-09-01",
                "source_record_id": "api-stats-9101",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1000000.00",
                "currency_code": "ILS",
            },
            {
                "draw_number": 9102,
                "draw_date": "2025-09-08",
                "source_record_id": "api-stats-9102",
                "source_revision": 1,
                "regular_numbers": [1, 2, 7, 8, 9, 10],
                "strong_numbers": [2],
                "jackpot_amount": "1100000.00",
                "currency_code": "ILS",
            },
        ],
    }
    import_status, import_body = _post_json(f"{base_url}/api/v1/import/draws", import_payload)

    with SessionLocal() as db:
        stats = StatisticsEngineService(db)
        snapshot_result = stats.generate_snapshot(
            game_code="IL_LOTTO",
            game_variant="main",
            rule_version="v1",
            created_by="api-stats-validation",
        )

    common_filters = {
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "date_from": "2025-09-01",
        "date_to": "2025-09-08",
    }
    freq_status, freq_body = _get_json(f"{base_url}/api/v1/stats/frequency", common_filters)
    strong_status, strong_body = _get_json(f"{base_url}/api/v1/stats/strong-number", common_filters)
    pairs_status, pairs_body = _get_json(f"{base_url}/api/v1/stats/pairs", common_filters)
    summary_status, summary_body = _get_json(f"{base_url}/api/v1/stats/summary", common_filters)

    health_status, health_body = _get_json(f"{base_url}/health")
    draws_status, draws_body = _get_json(f"{base_url}/api/v1/draws", {"page": 1, "page_size": 1})
    draw_id_status, draw_id_body = (0, {})
    draw_uid = None
    if draws_status == 200 and draws_body.get("items"):
        draw_uid = draws_body["items"][0]["draw_uid"]
        draw_id_status, draw_id_body = _get_json(f"{base_url}/api/v1/draws/{draw_uid}")

    with SessionLocal() as db:
        integrity = db.execute(
            text(
                "select "
                "(select count(*) from analytics_snapshots where status='published') as published_count, "
                "(select count(*) from pair_frequency where number_a >= number_b) as bad_pair_order, "
                "(select count(*) from number_frequency where number_value < 1) as bad_number_values"
            )
        ).first()

    # Ensure no predictive/recommendation/AI keys leak in stats responses.
    dumped = json.dumps(
        {
            "frequency": freq_body,
            "strong": strong_body,
            "pairs": pairs_body,
            "summary": summary_body,
        }
    ).lower()
    banned_tokens = ["prediction", "recommend", "ai_insight", "recommendation", "predict"]
    banned_hits = [token for token in banned_tokens if token in dumped]

    print(
        json.dumps(
            {
                "seed_import": {"status_code": import_status, "body": import_body},
                "snapshot_generation": snapshot_result.__dict__,
                "frequency": {"status_code": freq_status, "body": freq_body},
                "strong_number": {"status_code": strong_status, "body": strong_body},
                "pairs": {"status_code": pairs_status, "body": pairs_body},
                "summary": {"status_code": summary_status, "body": summary_body},
                "regression": {
                    "health": {"status_code": health_status, "body": health_body},
                    "import": {"status_code": import_status, "body": import_body},
                    "draws_list": {"status_code": draws_status, "body": draws_body},
                    "draw_by_id": {"status_code": draw_id_status, "body": draw_id_body},
                },
                "no_prediction_recommendation_tokens": {"banned_hits": banned_hits},
                "db_integrity": dict(integrity._mapping) if integrity else {},
            },
            indent=2,
            default=str,
        )
    )


if __name__ == "__main__":
    run_stats_api_validation()

