from __future__ import annotations

import json
import os
import uuid
from urllib import error, parse, request


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
    try:
        with request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body)
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        return http_err.code, json.loads(body) if body else {}


def run_draw_detail_validation() -> None:
    base_url = os.getenv("BASE_URL", "http://127.0.0.1:8000")

    import_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "api-draw-detail-seed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "api-draw-detail-validation",
        "dry_run": False,
        "records": [
            {
                "draw_number": 7101,
                "draw_date": "2025-07-01",
                "source_record_id": "draw-detail-seed-7101",
                "source_revision": 1,
                "regular_numbers": [3, 6, 9, 12, 15, 18],
                "strong_numbers": [4],
                "jackpot_amount": "4444444.00",
                "currency_code": "ILS",
            }
        ],
    }
    import_status, import_body = _post_json(f"{base_url}/api/v1/import/draws", import_payload)

    list_status, list_body = _get_json(f"{base_url}/api/v1/draws", {"page": 1, "page_size": 1, "sort": "draw_date_desc"})

    draw_uid = None
    if list_status == 200 and list_body.get("items"):
        draw_uid = list_body["items"][0]["draw_uid"]

    success_lookup_status, success_lookup_body = (0, {})
    if draw_uid:
        success_lookup_status, success_lookup_body = _get_json(f"{base_url}/api/v1/draws/{draw_uid}")

    missing_draw_uid = str(uuid.uuid4())
    missing_lookup_status, missing_lookup_body = _get_json(f"{base_url}/api/v1/draws/{missing_draw_uid}")

    health_status, health_body = _get_json(f"{base_url}/health")

    print(
        json.dumps(
            {
                "import_regression": {"status_code": import_status, "body": import_body},
                "list_regression": {"status_code": list_status, "body": list_body},
                "draw_lookup_success": {"status_code": success_lookup_status, "body": success_lookup_body},
                "draw_lookup_missing": {"status_code": missing_lookup_status, "body": missing_lookup_body},
                "health": {"status_code": health_status, "body": health_body},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run_draw_detail_validation()

