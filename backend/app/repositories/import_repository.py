from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.phase1 import (
    DataImportLog,
    DataImportRejection,
    DrawNumber,
    GameRule,
    LotteryDraw,
    StrongNumber,
    SystemAuditLog,
)
from app.schemas.import_pipeline import ImportBatchRequest, ImportDrawRecordInput


@dataclass
class ExistingDrawMatch:
    draw_revision_id: int
    is_current: bool
    source_revision: int
    draw_uid: uuid.UUID


class ImportRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_game_rule(self, *, game_code: str, game_variant: str, rule_version: str) -> Optional[GameRule]:
        stmt = (
            select(GameRule)
            .where(GameRule.game_code == game_code)
            .where(GameRule.game_variant == game_variant)
            .where(GameRule.rule_version == rule_version)
            .where(GameRule.is_active.is_(True))
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    def compute_batch_checksum(self, batch: ImportBatchRequest) -> str:
        normalized = json.dumps(batch.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def create_import_log(
        self,
        *,
        batch: ImportBatchRequest,
        checksum: str,
        started_at_utc: datetime,
    ) -> DataImportLog:
        import_log = DataImportLog(
            run_id=uuid.uuid4(),
            source_system=batch.source_system,
            source_object=batch.source_object,
            source_checksum_sha256=checksum,
            records_received=len(batch.records),
            records_valid=0,
            records_quarantined=0,
            status="running",
            error_summary=None,
            started_at_utc=started_at_utc,
            ended_at_utc=None,
            triggered_by=batch.triggered_by,
        )
        self.db.add(import_log)
        self.db.flush()
        return import_log

    def finalize_import_log(
        self,
        *,
        import_log: DataImportLog,
        records_valid: int,
        records_quarantined: int,
        error_summary: Optional[str],
    ) -> None:
        ended = datetime.now(timezone.utc)
        status = "succeeded"
        if records_quarantined > 0 and records_valid > 0:
            status = "partial"
        elif records_quarantined > 0 and records_valid == 0:
            status = "failed"

        import_log.records_valid = records_valid
        import_log.records_quarantined = records_quarantined
        import_log.status = status
        import_log.error_summary = error_summary
        import_log.ended_at_utc = ended
        self.db.flush()

    def log_rejection(
        self,
        *,
        import_id: int,
        source_pointer: str,
        rejection_code: str,
        rejection_detail: str,
        payload: dict,
    ) -> None:
        payload_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        rejection = DataImportRejection(
            import_id=import_id,
            source_pointer=source_pointer,
            rejection_code=rejection_code,
            rejection_detail=rejection_detail,
            rejected_payload_hash=payload_hash,
            resolution_status="open",
        )
        self.db.add(rejection)

    def find_existing_draw(self, *, source_system: str, source_record_id: str) -> Optional[ExistingDrawMatch]:
        stmt = (
            select(
                LotteryDraw.draw_revision_id,
                LotteryDraw.is_current,
                LotteryDraw.source_revision,
                LotteryDraw.draw_uid,
            )
            .where(LotteryDraw.source_system == source_system)
            .where(LotteryDraw.source_record_id == source_record_id)
            .order_by(LotteryDraw.source_revision.desc())
            .limit(1)
        )
        row = self.db.execute(stmt).first()
        if not row:
            return None
        return ExistingDrawMatch(
            draw_revision_id=row.draw_revision_id,
            is_current=row.is_current,
            source_revision=row.source_revision,
            draw_uid=row.draw_uid,
        )

    def mark_draw_not_current(self, *, draw_revision_id: int) -> None:
        self.db.execute(
            update(LotteryDraw)
            .where(LotteryDraw.draw_revision_id == draw_revision_id)
            .values(is_current=False, effective_to_utc=datetime.now(timezone.utc))
        )

    def insert_draw(
        self,
        *,
        import_id: int,
        game_rule_id: int,
        record: ImportDrawRecordInput,
        draw_uid: Optional[uuid.UUID],
        supersedes_draw_revision_id: Optional[int],
        record_checksum_sha256: str,
    ) -> LotteryDraw:
        draw = LotteryDraw(
            draw_uid=draw_uid or uuid.uuid4(),
            import_id=import_id,
            game_rule_id=game_rule_id,
            supersedes_draw_revision_id=supersedes_draw_revision_id,
            draw_number=record.draw_number,
            draw_date=record.draw_date,
            draw_timestamp_utc=record.draw_timestamp_utc,
            source_system="official_israeli_lotto",
            source_record_id=record.source_record_id,
            source_revision=record.source_revision,
            jackpot_amount=record.jackpot_amount,
            currency_code=record.currency_code,
            is_current=True,
            record_checksum_sha256=record_checksum_sha256,
        )
        self.db.add(draw)
        self.db.flush()
        return draw

    def insert_draw_numbers(self, *, draw_revision_id: int, regular_numbers: list[int]) -> None:
        for idx, value in enumerate(regular_numbers, start=1):
            self.db.add(
                DrawNumber(
                    draw_revision_id=draw_revision_id,
                    position_no=idx,
                    number_value=value,
                )
            )

    def insert_strong_numbers(self, *, draw_revision_id: int, strong_numbers: list[int]) -> None:
        for idx, value in enumerate(strong_numbers, start=1):
            self.db.add(
                StrongNumber(
                    draw_revision_id=draw_revision_id,
                    position_no=idx,
                    strong_value=value,
                )
            )

    def compute_record_checksum(self, record: ImportDrawRecordInput) -> str:
        normalized = json.dumps(record.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def log_system_audit(
        self,
        *,
        actor_id: str,
        action: str,
        entity_type: str,
        entity_id: str,
        result: str,
        severity: str,
        after_state: Optional[dict] = None,
    ) -> None:
        audit = SystemAuditLog(
            actor_type="service",
            actor_id=actor_id,
            actor_role="importer",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            result=result,
            severity=severity,
            after_state=after_state,
            retention_until_date=date.today() + timedelta(days=3650),
        )
        self.db.add(audit)

