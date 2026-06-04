from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.models.phase1 import GameRule


def ensure_phase1_rule(db: Session) -> GameRule:
    existing = (
        db.query(GameRule)
        .filter(GameRule.game_code == "IL_LOTTO")
        .filter(GameRule.game_variant == "main")
        .filter(GameRule.rule_version == "v1")
        .first()
    )
    if existing:
        return existing

    rule = GameRule(
        game_code="IL_LOTTO",
        game_variant="main",
        rule_version="v1",
        effective_start_date=date(2020, 1, 1),
        regular_min_value=1,
        regular_max_value=37,
        regular_count=6,
        strong_min_value=1,
        strong_max_value=7,
        strong_count=1,
        is_active=True,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def import_payload(records: list[dict], *, dry_run: bool = False) -> dict:
    return {
        "source_system": "official_israeli_lotto",
        "source_object": "pytest-seed.json",
        "game_code": "IL_LOTTO",
        "game_variant": "main",
        "rule_version": "v1",
        "triggered_by": "pytest",
        "dry_run": dry_run,
        "records": records,
    }
