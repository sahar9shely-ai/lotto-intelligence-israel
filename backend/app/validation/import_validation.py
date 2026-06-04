from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

from app.models.phase1 import GameRule
from app.schemas.import_pipeline import ImportBatchRequest, ImportDrawRecordInput


@dataclass
class ValidationIssue:
    code: str
    detail: str


def validate_rule_exists(rule: Optional[GameRule]) -> Optional[ValidationIssue]:
    if rule is None:
        return ValidationIssue(code="RULE_NOT_FOUND", detail="Requested game rule was not found.")
    return None


def validate_draw_against_rule(record: ImportDrawRecordInput, rule: GameRule) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    if record.draw_date < rule.effective_start_date:
        issues.append(
            ValidationIssue(
                code="DRAW_DATE_BEFORE_RULE",
                detail=f"Draw date {record.draw_date} is before rule start {rule.effective_start_date}.",
            )
        )
    if rule.effective_end_date and record.draw_date > rule.effective_end_date:
        issues.append(
            ValidationIssue(
                code="DRAW_DATE_AFTER_RULE",
                detail=f"Draw date {record.draw_date} is after rule end {rule.effective_end_date}.",
            )
        )

    if len(record.regular_numbers) != rule.regular_count:
        issues.append(
            ValidationIssue(
                code="REGULAR_COUNT_MISMATCH",
                detail=f"Expected {rule.regular_count} regular numbers, got {len(record.regular_numbers)}.",
            )
        )
    if len(set(record.regular_numbers)) != len(record.regular_numbers):
        issues.append(
            ValidationIssue(code="REGULAR_DUPLICATE_VALUES", detail="Regular numbers contain duplicates.")
        )
    for value in record.regular_numbers:
        if value < rule.regular_min_value or value > rule.regular_max_value:
            issues.append(
                ValidationIssue(
                    code="REGULAR_VALUE_OUT_OF_RANGE",
                    detail=(
                        f"Regular number {value} outside allowed range "
                        f"[{rule.regular_min_value}, {rule.regular_max_value}]."
                    ),
                )
            )

    if len(record.strong_numbers) != rule.strong_count:
        issues.append(
            ValidationIssue(
                code="STRONG_COUNT_MISMATCH",
                detail=f"Expected {rule.strong_count} strong numbers, got {len(record.strong_numbers)}.",
            )
        )
    if len(set(record.strong_numbers)) != len(record.strong_numbers):
        issues.append(
            ValidationIssue(code="STRONG_DUPLICATE_VALUES", detail="Strong numbers contain duplicates.")
        )

    if rule.strong_count > 0 and rule.strong_min_value is not None and rule.strong_max_value is not None:
        for value in record.strong_numbers:
            if value < rule.strong_min_value or value > rule.strong_max_value:
                issues.append(
                    ValidationIssue(
                        code="STRONG_VALUE_OUT_OF_RANGE",
                        detail=(
                            f"Strong number {value} outside allowed range "
                            f"[{rule.strong_min_value}, {rule.strong_max_value}]."
                        ),
                    )
                )

    return issues


def validate_batch_internal_duplicates(batch: ImportBatchRequest) -> list[ValidationIssue]:
    seen: set[tuple[date, int, str, int]] = set()
    issues: list[ValidationIssue] = []
    for record in batch.records:
        key = (record.draw_date, record.draw_number, record.source_record_id, record.source_revision)
        if key in seen:
            issues.append(
                ValidationIssue(
                    code="BATCH_DUPLICATE_RECORD",
                    detail=(
                        "Duplicate record in batch for draw_date="
                        f"{record.draw_date}, draw_number={record.draw_number}, "
                        f"source_record_id={record.source_record_id}, source_revision={record.source_revision}."
                    ),
                )
            )
        seen.add(key)
    return issues

