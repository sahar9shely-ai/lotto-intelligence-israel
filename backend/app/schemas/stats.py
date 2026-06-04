from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class StatsSnapshotRef(BaseModel):
    snapshot_id: int
    snapshot_code: str
    game_code: str
    game_variant: str
    rule_version: str
    window_start_date: date
    window_end_date: date
    published_at_utc: Optional[datetime]


class FrequencyItem(BaseModel):
    number_value: int
    appearance_count: int
    draw_count: int
    frequency_pct: Decimal
    recency_days: int


class FrequencyResponse(BaseModel):
    snapshot: StatsSnapshotRef
    items: list[FrequencyItem]


class StrongNumberItem(BaseModel):
    strong_value: int
    appearance_count: int
    draw_count: int
    frequency_pct: Decimal


class StrongNumberResponse(BaseModel):
    snapshot: StatsSnapshotRef
    items: list[StrongNumberItem]


class PairItem(BaseModel):
    number_a: int
    number_b: int
    cooccurrence_count: int
    support_pct: Decimal


class PairResponse(BaseModel):
    snapshot: StatsSnapshotRef
    items: list[PairItem]


class StatsSummaryResponse(BaseModel):
    snapshot: StatsSnapshotRef
    dataset_hash_sha256: str
    algorithm_version: str
    engine_build_id: str
    draw_count: int
    regular_number_rows: int
    strong_number_rows: int
    pair_rows: int
    lineage_import_ids: list[int]


class SnapshotGenerateRequest(BaseModel):
    game_code: str = Field(min_length=1, max_length=32)
    game_variant: str = Field(min_length=1, max_length=32)
    rule_version: str = Field(min_length=1, max_length=32)
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    dry_run: bool = False
    triggered_by: str = Field(min_length=1, max_length=64)


class SnapshotGenerateResponse(BaseModel):
    snapshot_id: int
    reused_existing: bool
    draw_count: int
    dataset_hash_sha256: str
    status: str

