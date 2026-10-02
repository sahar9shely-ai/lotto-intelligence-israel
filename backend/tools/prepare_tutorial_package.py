"""Stage an explicitly owner-approved package, or validate it without copying.

This tool never upgrades the license of existing audio. The source must contain a
publication-approval.json identifying the exact owner-approved files. Provider and
license information is preserved separately from the owner's publication decision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.tutorial_service import ASSET_TYPES, LESSONS, asset_path, _signature, _validated_package


def prepare(source: Path, destination: Path | None = None) -> dict:
    source = source.resolve()
    clearance = json.loads((source / "publication-approval.json").read_text("utf-8"))
    if (clearance.get("scope") != "investor_app" or clearance.get("owner_publication_approved") is not True
            or not str(clearance.get("approved_on", "")).strip()):
        raise ValueError("Explicit owner publication approval is required.")
    records = clearance.get("lessons", [])
    if len(records) != len(LESSONS):
        raise ValueError("Exactly seven approved lessons are required.")
    by_id = {row["id"]: row for row in records}
    if set(by_id) != {row[0] for row in LESSONS}:
        raise ValueError("The approved lesson identifiers do not match the app chapters.")
    staged = []
    total = 0
    for lesson_id, *_ in LESSONS:
        record = by_id[lesson_id]
        duration = float(record["duration_seconds"])
        if not 0 < duration <= 600:
            raise ValueError("Invalid lesson duration.")
        hashes = record["sha256"]
        for asset, (_, _, _, max_bytes) in ASSET_TYPES.items():
            path = asset_path(source, lesson_id, asset)
            size = path.stat().st_size
            if not path.is_file() or not 0 < size <= max_bytes:
                raise ValueError(f"Missing/oversized {lesson_id} {asset}.")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != hashes.get(asset):
                raise ValueError(f"The approval does not identify the current {lesson_id} {asset}.")
            if asset == "captions" and not path.read_text("utf-8").startswith("WEBVTT"):
                raise ValueError("Captions must be UTF-8 WebVTT.")
            if asset == "transcript" and not path.read_text("utf-8").strip():
                raise ValueError("Each lesson needs a readable transcript.")
            total += size
            staged.append((path, path.relative_to(source)))
    manifest = {**clearance, "schema_version": 1, "lessons": records}
    if destination is not None:
        destination = destination.resolve()
        if destination.exists():
            raise ValueError("Use a fresh destination directory; existing packages are never overwritten.")
        destination.mkdir(parents=True)
        for original, relative in staged:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, target)
        # Publication marker comes last: partial copies remain inaccessible.
        (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
        if len(_validated_package(str(destination), _signature(destination))) != 7:
            raise ValueError("Copied package failed server validation.")
    return {"owner_approved": True, "commercial_license_confirmed": clearance.get("commercial_license_confirmed", False),
            "lessons": len(records), "files": len(staged), "total_bytes": total,
            "copied": destination is not None}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--destination", type=Path, help="Fresh destination, e.g. backend/tutorial-media; omit for preflight only.")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.source, args.destination), ensure_ascii=False))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, f"Tutorial package not ready: {exc}\n")


if __name__ == "__main__":
    main()
