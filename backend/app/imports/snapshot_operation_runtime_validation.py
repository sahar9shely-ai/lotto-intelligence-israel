from __future__ import annotations

import json
import os
from urllib import error, parse, request
from uuid import uuid4


def _post_json(url: str, payload: dict) -> tuple[int, dict]:
    req = request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        return http_err.code, json.loads(body) if body else {}


def _get_json(url: str, params: dict | None = None) -> tuple[int, dict]:
    target = f"{url}?{parse.urlencode(params)}" if params else url
    req = request.Request(url=target, method="GET")
    try:
        with request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_err:
        body = http_err.read().decode("utf-8")
        return http_err.code, json.loads(body) if body else {}


def run_validation() -> None:
    base_url = os.getenv("BASE_URL", "http://127.0.0.1:8005")
    seed_id = str(uuid4())[:8]
    draw_number = 800000 + int(seed_id[:4], 16)
    import_payload = {
        "source_system": "official_israeli_lotto",
        "source_object": "snapshot-op-runtime-seed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "snapshot-op-runtime",
        "dry_run": False,
        "records": [
            {
                "draw_number": draw_number,
                "draw_date": "2025-12-05",
                "source_record_id": f"snapshot-runtime-{seed_id}",
                "source_revision": 1,
                "regular_numbers": [1, 2, 3, 4, 5, 6],
                "strong_numbers": [1],
                "jackpot_amount": "1230000.00",
                "currency_code": "ILS",
            }
        ],
    }
    import_result = _post_json(f"{base_url}/api/v1/import/draws", import_payload)

    op_payload = {
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "snapshot-op-runtime",
    }
    first = _post_json(f"{base_url}/api/v1/admin/stats/snapshots/generate", op_payload)
    reuse = _post_json(f"{base_url}/api/v1/admin/stats/snapshots/generate", op_payload)
    dry_run = _post_json(
        f"{base_url}/api/v1/admin/stats/snapshots/generate",
        {
            **op_payload,
            "dry_run": True,
            "date_from": "2025-01-01",
            "date_to": "2025-12-31",
        },
    )

    revision_payload = {
        **import_payload,
        "records": [
            {
                "draw_number": draw_number,
                "draw_date": "2025-12-05",
                "source_record_id": f"snapshot-runtime-{seed_id}",
                "source_revision": 2,
                "regular_numbers": [1, 2, 3, 4, 5, 7],
                "strong_numbers": [1],
                "jackpot_amount": "1240000.00",
                "currency_code": "ILS",
            }
        ],
    }
    revision_import = _post_json(f"{base_url}/api/v1/import/draws", revision_payload)
    changed = _post_json(f"{base_url}/api/v1/admin/stats/snapshots/generate", op_payload)

    stats_params = {"game_code": "IL_LOTTO", "game_variant": "main", "rule_version": "v1"}
    health = _get_json(f"{base_url}/health")
    stats_frequency = _get_json(f"{base_url}/api/v1/stats/frequency", stats_params)
    stats_strong = _get_json(f"{base_url}/api/v1/stats/strong-number", stats_params)
    stats_pairs = _get_json(f"{base_url}/api/v1/stats/pairs", stats_params)
    stats_summary = _get_json(f"{base_url}/api/v1/stats/summary", stats_params)

    print(
        json.dumps(
            {
                "import_seed": {"status_code": import_result[0], "body": import_result[1]},
                "snapshot_generate": {"status_code": first[0], "body": first[1]},
                "snapshot_reuse": {"status_code": reuse[0], "body": reuse[1]},
                "snapshot_dry_run": {"status_code": dry_run[0], "body": dry_run[1]},
                "import_revision": {"status_code": revision_import[0], "body": revision_import[1]},
                "snapshot_after_change": {"status_code": changed[0], "body": changed[1]},
                "stats_endpoints": {
                    "frequency": {"status_code": stats_frequency[0], "body": stats_frequency[1]},
                    "strong_number": {"status_code": stats_strong[0], "body": stats_strong[1]},
                    "pairs": {"status_code": stats_pairs[0], "body": stats_pairs[1]},
                    "summary": {"status_code": stats_summary[0], "body": stats_summary[1]},
                },
                "health": {"status_code": health[0], "body": health[1]},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run_validation()

