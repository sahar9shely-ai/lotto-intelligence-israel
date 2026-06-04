from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class DrawItemResponse(BaseModel):
    draw_uid: UUID
    draw_number: int
    draw_date: date
    draw_timestamp_utc: Optional[datetime]
    source_system: str
    source_record_id: str
    source_revision: int
    jackpot_amount: Optional[Decimal]
    currency_code: str
    game_code: str
    game_variant: str
    rule_version: str
    regular_numbers: list[int]
    strong_numbers: list[int]


class DrawListResponse(BaseModel):
    total_count: int
    page: int
    page_size: int
    items: list[DrawItemResponse]

