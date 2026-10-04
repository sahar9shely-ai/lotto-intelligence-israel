"""Read-only investor guides. A complete owner-approved media package is required.

Media never lives in frontend/public: every byte goes through authenticated API
routes. The browser creates temporary Blob URLs for its selected short lesson.
"""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.schemas.tutorials import TutorialLessonOut

LESSONS = (
    ("01-welcome", "היכרות ולוח הבקרה", "הכניסה לתיק שלך והנתונים המרכזיים בלוח הבקרה."),
    ("02-plans-savings", "מסלולים, קרן וחיסכון", "פרטי המסלול שלך ומעקב אחרי הקרן והחיסכון שנצבר."),
    ("03-payments", "תשלומים ואישורי קבלה", "צפייה בתשלומים ואישור שקיבלת את הכסף."),
    ("04-offers-signing", "הצעות וחתימה", "עיון בהצעה ובתנאים וחתימה על ההסכם הדיגיטלי."),
    ("05-balance-ending", "סיום מסלול ויתרה זמינה", "חתימה על הסכם סיום ומעקב אחרי היתרה הזמינה."),
    ("06-help-requests", "בקשות, מסמכים ועוזר אישי", "שליחת בקשה, פתיחת מסמכים ושימוש בעוזר האישי."),
    ("07-closing", "מוכנים להמשיך", "סיום קצר וחזרה לתיק שלך."),
    ("08-notifications", "הפעלת התראות בטלפון", "הפעלת התראות על בקשות אישור קבלת תשלום ועל מסמכים לחתימה."),
)
ASSET_TYPES = {
    "video": ("videos", ".mp4", "video/mp4", 50 * 1024 * 1024),
    "poster": ("posters", ".jpg", "image/jpeg", 5 * 1024 * 1024),
    "captions": ("captions", ".vtt", "text/vtt; charset=utf-8", 256 * 1024),
    "transcript": ("transcripts", ".txt", "text/plain; charset=utf-8", 64 * 1024),
}


def media_root() -> Path:
    return Path(settings.investor_tutorials_media_dir).expanduser().resolve()


def asset_path(root: Path, lesson_id: str, asset: str) -> Path:
    if lesson_id not in {row[0] for row in LESSONS} or asset not in ASSET_TYPES:
        raise ValueError("Unknown tutorial asset")
    folder, suffix, _, _ = ASSET_TYPES[asset]
    path = (root / folder / f"{lesson_id}{suffix}").resolve()
    if not path.is_relative_to(root):
        raise ValueError("Tutorial asset is outside its media directory")
    return path


def _signature(root: Path) -> tuple:
    manifest = (root / "manifest.json").resolve()
    if not manifest.is_relative_to(root):
        raise ValueError("Tutorial manifest is outside its media directory")
    paths = [manifest]
    paths.extend(asset_path(root, lesson_id, asset) for lesson_id, *_ in LESSONS for asset in ASSET_TYPES)
    return tuple((str(path), path.stat().st_size, path.stat().st_mtime_ns) for path in paths)


@lru_cache(maxsize=4)
def _validated_package(root_str: str, signature: tuple) -> tuple[TutorialLessonOut, ...]:
    # The cache key covers every asset; replacements invalidate validation.
    root = Path(root_str)
    manifest_path = root / "manifest.json"
    if manifest_path.stat().st_size > 256 * 1024:
        raise ValueError("Oversized tutorial manifest")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("Invalid tutorial manifest")
    if (
        manifest.get("schema_version") != 1
        or manifest.get("owner_publication_approved") is not True
        or not str(manifest.get("approved_on", "")).strip()
        or manifest.get("scope") != "investor_app"
    ):
        raise ValueError("Tutorial package is not cleared for the investor app")
    entries = manifest.get("lessons", [])
    if not isinstance(entries, list) or len(entries) != len(LESSONS):
        raise ValueError(f"Tutorial package must contain all {len(LESSONS)} lessons")
    by_id = {entry.get("id"): entry for entry in entries if isinstance(entry, dict)}
    if set(by_id) != {row[0] for row in LESSONS}:
        raise ValueError("Tutorial lesson list is incomplete")
    lessons = []
    for lesson_id, title, summary in LESSONS:
        entry = by_id[lesson_id]
        duration = float(entry["duration_seconds"])
        if not 0 < duration <= 600:
            raise ValueError("Invalid tutorial duration")
        hashes = entry.get("sha256", {})
        for asset, (_, _, _, max_bytes) in ASSET_TYPES.items():
            path = asset_path(root, lesson_id, asset)
            if not path.is_file() or not 0 < path.stat().st_size <= max_bytes:
                raise ValueError("Missing or oversized tutorial asset")
            if hashlib.sha256(path.read_bytes()).hexdigest() != hashes.get(asset):
                raise ValueError("Tutorial asset does not match its publication manifest")
        transcript = asset_path(root, lesson_id, "transcript").read_text("utf-8").strip()
        captions = asset_path(root, lesson_id, "captions").read_text("utf-8")
        if not transcript or not captions.startswith("WEBVTT"):
            raise ValueError("Invalid tutorial text")
        lessons.append(TutorialLessonOut(id=lesson_id, title=title, summary=summary,
                                        duration_seconds=duration, transcript=transcript))
    return tuple(lessons)


def published_lessons() -> tuple[TutorialLessonOut, ...]:
    if not settings.investor_tutorials_enabled:
        return ()
    root = media_root()
    try:
        return _validated_package(str(root), _signature(root))
    except (OSError, ValueError, KeyError, TypeError):
        # Fail closed for incomplete deployments, unapproved drafts and corruption.
        return ()
