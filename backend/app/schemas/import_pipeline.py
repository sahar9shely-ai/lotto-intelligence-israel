from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ImportDrawRecordInput(BaseModel):
    draw_number: int = Field(gt=0)
    draw_date: date
    source_record_id: str = Field(min_length=1, max_length=128)
    source_revision: int = Field(default=1, ge=1)
    draw_timestamp_utc: Optional[datetime] = None
    jackpot_amount: Optional[Decimal] = Field(default=None, ge=0)
    currency_code: str = Field(default="ILS", min_length=3, max_length=3)
    regular_numbers: list[int] = Field(min_length=1)
    strong_numbers: list[int] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")

    @field_validator("currency_code")
    @classmethod
    def validate_currency_code(cls, value: str) -> str:
        return value.upper()


class ImportBatchRequest(BaseModel):
    source_system: str = Field(min_length=1, max_length=64)
    source_object: str = Field(min_length=1, max_length=256)
    game_code: str = Field(min_length=1, max_length=32)
    game_variant: str = Field(min_length=1, max_length=32)
    rule_version: str = Field(min_length=1, max_length=32)
    triggered_by: str = Field(min_length=1, max_length=80)
    dry_run: bool = False
    records: list[ImportDrawRecordInput] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class ImportRecordOutcome(BaseModel):
    source_record_id: str
    draw_number: int
    draw_date: date
    accepted: bool
    rejection_code: Optional[str] = None
    rejection_detail: Optional[str] = None
    superseded_draw_revision_id: Optional[int] = None


class ImportBatchResult(BaseModel):
    import_id: int
    run_id: str
    source_checksum_sha256: str
    status: str
    records_received: int
    records_valid: int
    records_quarantined: int
    dry_run: bool
    outcomes: list[ImportRecordOutcome]
    started_at_utc: datetime
    ended_at_utc: datetime

