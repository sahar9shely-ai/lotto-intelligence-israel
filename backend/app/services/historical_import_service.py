from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.repositories.import_repository import ImportRepository
from app.schemas.import_pipeline import (
    ImportBatchRequest,
    ImportBatchResult,
    ImportRecordOutcome,
)
from app.validation.import_validation import (
    ValidationIssue,
    validate_draw_against_rule,
    validate_rule_exists,
)


@dataclass
class ImportCounters:
    received: int = 0
    valid: int = 0
    quarantined: int = 0


class HistoricalDataImportService:
    """
    Transactional importer for official Israeli Lotto historical draw records.
    """

    OFFICIAL_SOURCE = "official_israeli_lotto"

    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ImportRepository(db)

    def run_batch_import(self, batch: ImportBatchRequest) -> ImportBatchResult:
        started_at = datetime.now(timezone.utc)
        checksum = self.repo.compute_batch_checksum(batch)
        outcomes: list[ImportRecordOutcome] = []
        counters = ImportCounters(received=len(batch.records))

        with self.db.begin():
            import_log = self.repo.create_import_log(
                batch=batch,
                checksum=checksum,
                started_at_utc=started_at,
            )

            if batch.source_system != self.OFFICIAL_SOURCE:
                issue = ValidationIssue(
                    code="SOURCE_NOT_ALLOWED",
                    detail=f"Source '{batch.source_system}' is not allowed. Expected '{self.OFFICIAL_SOURCE}'.",
                )
                self._reject_all_records(
                    batch=batch,
                    import_id=import_log.import_id,
                    issue=issue,
                    outcomes=outcomes,
                    counters=counters,
                )
                self.repo.finalize_import_log(
                    import_log=import_log,
                    records_valid=counters.valid,
                    records_quarantined=counters.quarantined,
                    error_summary=issue.detail,
                )
                self.repo.log_system_audit(
                    actor_id=batch.triggered_by,
                    action="historical_import_rejected",
                    entity_type="data_import_logs",
                    entity_id=str(import_log.import_id),
                    result="failure",
                    severity="warn",
                    after_state={
                        "status": "failed",
                        "reason": issue.code,
                        "records_received": counters.received,
                    },
                )
                if batch.dry_run:
                    self.db.rollback()
                    return self._build_result(
                        import_log_id=0,
                        run_id="dry-run",
                        checksum=checksum,
                        counters=counters,
                        dry_run=True,
                        outcomes=outcomes,
                        started_at=started_at,
                        ended_at=datetime.now(timezone.utc),
                        status="failed",
                    )
                return self._build_result(
                    import_log_id=import_log.import_id,
                    run_id=str(import_log.run_id),
                    checksum=checksum,
                    counters=counters,
                    dry_run=batch.dry_run,
                    outcomes=outcomes,
                    started_at=started_at,
                    ended_at=datetime.now(timezone.utc),
                    status=import_log.status,
                )

            rule = self.repo.resolve_game_rule(
                game_code=batch.game_code,
                game_variant=batch.game_variant,
                rule_version=batch.rule_version,
            )
            rule_issue = validate_rule_exists(rule)
            if rule_issue:
                self._reject_all_records(
                    batch=batch,
                    import_id=import_log.import_id,
                    issue=rule_issue,
                    outcomes=outcomes,
                    counters=counters,
                )
                self.repo.finalize_import_log(
                    import_log=import_log,
                    records_valid=counters.valid,
                    records_quarantined=counters.quarantined,
                    error_summary=rule_issue.detail,
                )
                self.repo.log_system_audit(
                    actor_id=batch.triggered_by,
                    action="historical_import_rejected",
                    entity_type="data_import_logs",
                    entity_id=str(import_log.import_id),
                    result="failure",
                    severity="warn",
                    after_state={
                        "status": "failed",
                        "reason": rule_issue.code,
                        "records_received": counters.received,
                    },
                )
                if batch.dry_run:
                    self.db.rollback()
                    return self._build_result(
                        import_log_id=0,
                        run_id="dry-run",
                        checksum=checksum,
                        counters=counters,
                        dry_run=True,
                        outcomes=outcomes,
                        started_at=started_at,
                        ended_at=datetime.now(timezone.utc),
                        status="failed",
                    )
                return self._build_result(
                    import_log_id=import_log.import_id,
                    run_id=str(import_log.run_id),
                    checksum=checksum,
                    counters=counters,
                    dry_run=batch.dry_run,
                    outcomes=outcomes,
                    started_at=started_at,
                    ended_at=datetime.now(timezone.utc),
                    status=import_log.status,
                )

            assert rule is not None

            seen_batch_keys: set[tuple] = set()

            for index, record in enumerate(batch.records):
                source_pointer = f"records[{index}]"
                record_key = (
                    record.draw_date,
                    record.draw_number,
                    record.source_record_id,
                    record.source_revision,
                )
                if record_key in seen_batch_keys:
                    issue = ValidationIssue(
                        code="BATCH_DUPLICATE_RECORD",
                        detail=(
                            f"Duplicate draw in same batch for source_record_id={record.source_record_id}, "
                            f"source_revision={record.source_revision}."
                        ),
                    )
                else:
                    seen_batch_keys.add(record_key)
                    issue = None

                if issue is None:
                    issue = self._validate_record(
                        batch=batch,
                        record=record,
                        rule=rule,
                    )

                if issue is not None:
                    counters.quarantined += 1
                    self.repo.log_rejection(
                        import_id=import_log.import_id,
                        source_pointer=source_pointer,
                        rejection_code=issue.code,
                        rejection_detail=issue.detail,
                        payload=record.model_dump(mode="json"),
                    )
                    outcomes.append(
                        ImportRecordOutcome(
                            source_record_id=record.source_record_id,
                            draw_number=record.draw_number,
                            draw_date=record.draw_date,
                            accepted=False,
                            rejection_code=issue.code,
                            rejection_detail=issue.detail,
                        )
                    )
                    continue

                existing = self.repo.find_existing_draw(
                    source_system=self.OFFICIAL_SOURCE,
                    source_record_id=record.source_record_id,
                )

                superseded_id: Optional[int] = None
                draw_uid = None
                if existing is not None:
                    if record.source_revision <= existing.source_revision:
                        issue = ValidationIssue(
                            code="STALE_SOURCE_REVISION",
                            detail=(
                                f"Incoming source_revision={record.source_revision} is not newer than "
                                f"existing source_revision={existing.source_revision}."
                            ),
                        )
                        counters.quarantined += 1
                        self.repo.log_rejection(
                            import_id=import_log.import_id,
                            source_pointer=source_pointer,
                            rejection_code=issue.code,
                            rejection_detail=issue.detail,
                            payload=record.model_dump(mode="json"),
                        )
                        outcomes.append(
                            ImportRecordOutcome(
                                source_record_id=record.source_record_id,
                                draw_number=record.draw_number,
                                draw_date=record.draw_date,
                                accepted=False,
                                rejection_code=issue.code,
                                rejection_detail=issue.detail,
                            )
                        )
                        continue

                    superseded_id = existing.draw_revision_id
                    draw_uid = existing.draw_uid
                    if not batch.dry_run and existing.is_current:
                        self.repo.mark_draw_not_current(draw_revision_id=existing.draw_revision_id)

                counters.valid += 1
                if not batch.dry_run:
                    record_checksum = self.repo.compute_record_checksum(record)
                    draw = self.repo.insert_draw(
                        import_id=import_log.import_id,
                        game_rule_id=rule.game_rule_id,
                        record=record,
                        draw_uid=draw_uid,
                        supersedes_draw_revision_id=superseded_id,
                        record_checksum_sha256=record_checksum,
                    )
                    self.repo.insert_draw_numbers(
                        draw_revision_id=draw.draw_revision_id,
                        regular_numbers=record.regular_numbers,
                    )
                    self.repo.insert_strong_numbers(
                        draw_revision_id=draw.draw_revision_id,
                        strong_numbers=record.strong_numbers,
                    )

                outcomes.append(
                    ImportRecordOutcome(
                        source_record_id=record.source_record_id,
                        draw_number=record.draw_number,
                        draw_date=record.draw_date,
                        accepted=True,
                        superseded_draw_revision_id=superseded_id,
                    )
                )

            error_summary = None
            if counters.quarantined > 0 and counters.valid == 0:
                error_summary = "All records quarantined."
            elif counters.quarantined > 0:
                error_summary = f"{counters.quarantined} records quarantined."

            self.repo.finalize_import_log(
                import_log=import_log,
                records_valid=counters.valid,
                records_quarantined=counters.quarantined,
                error_summary=error_summary,
            )
            self.repo.log_system_audit(
                actor_id=batch.triggered_by,
                action="historical_import_completed",
                entity_type="data_import_logs",
                entity_id=str(import_log.import_id),
                result="success" if counters.quarantined == 0 else "failure",
                severity="info" if counters.quarantined == 0 else "warn",
                after_state={
                    "status": import_log.status,
                    "records_received": counters.received,
                    "records_valid": counters.valid,
                    "records_quarantined": counters.quarantined,
                    "dry_run": batch.dry_run,
                },
            )

            # Rollback-safe dry run: revert all DB changes while still returning deterministic outcomes.
            if batch.dry_run:
                self.db.rollback()
                ended_at = datetime.now(timezone.utc)
                status = "succeeded" if counters.quarantined == 0 else ("failed" if counters.valid == 0 else "partial")
                return self._build_result(
                    import_log_id=0,
                    run_id="dry-run",
                    checksum=checksum,
                    counters=counters,
                    dry_run=True,
                    outcomes=outcomes,
                    started_at=started_at,
                    ended_at=ended_at,
                    status=status,
                )

            ended_at = import_log.ended_at_utc or datetime.now(timezone.utc)
            return self._build_result(
                import_log_id=import_log.import_id,
                run_id=str(import_log.run_id),
                checksum=checksum,
                counters=counters,
                dry_run=False,
                outcomes=outcomes,
                started_at=started_at,
                ended_at=ended_at,
                status=import_log.status,
            )

    def _validate_record(
        self,
        *,
        batch: ImportBatchRequest,
        record,
        rule,
    ) -> Optional[ValidationIssue]:
        issues = validate_draw_against_rule(record, rule)
        if issues:
            return issues[0]

        if batch.source_system != self.OFFICIAL_SOURCE:
            return ValidationIssue(
                code="SOURCE_NOT_ALLOWED",
                detail=f"Source '{batch.source_system}' is not allowed.",
            )

        return None

    def _reject_all_records(
        self,
        *,
        batch: ImportBatchRequest,
        import_id: int,
        issue: ValidationIssue,
        outcomes: list[ImportRecordOutcome],
        counters: ImportCounters,
    ) -> None:
        for idx, record in enumerate(batch.records):
            counters.quarantined += 1
            self.repo.log_rejection(
                import_id=import_id,
                source_pointer=f"records[{idx}]",
                rejection_code=issue.code,
                rejection_detail=issue.detail,
                payload=record.model_dump(mode="json"),
            )
            outcomes.append(
                ImportRecordOutcome(
                    source_record_id=record.source_record_id,
                    draw_number=record.draw_number,
                    draw_date=record.draw_date,
                    accepted=False,
                    rejection_code=issue.code,
                    rejection_detail=issue.detail,
                )
            )

    @staticmethod
    def _build_result(
        *,
        import_log_id: int,
        run_id: str,
        checksum: str,
        counters: ImportCounters,
        dry_run: bool,
        outcomes: list[ImportRecordOutcome],
        started_at: datetime,
        ended_at: datetime,
        status: str,
    ) -> ImportBatchResult:
        return ImportBatchResult(
            import_id=import_log_id,
            run_id=run_id,
            source_checksum_sha256=checksum,
            status=status,
            records_received=counters.received,
            records_valid=counters.valid,
            records_quarantined=counters.quarantined,
            dry_run=dry_run,
            outcomes=outcomes,
            started_at_utc=started_at,
            ended_at_utc=ended_at,
        )

