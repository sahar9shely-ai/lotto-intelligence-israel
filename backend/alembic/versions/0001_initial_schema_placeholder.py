"""phase1_initial_schema

Revision ID: 0001_phase1_initial_schema
Revises:
Create Date: 2026-06-04 21:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001_phase1_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "game_rules",
        sa.Column("game_rule_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("game_code", sa.String(length=32), nullable=False),
        sa.Column("game_variant", sa.String(length=32), nullable=False),
        sa.Column("rule_version", sa.String(length=32), nullable=False),
        sa.Column("effective_start_date", sa.Date(), nullable=False),
        sa.Column("effective_end_date", sa.Date(), nullable=True),
        sa.Column("regular_min_value", sa.SmallInteger(), nullable=False),
        sa.Column("regular_max_value", sa.SmallInteger(), nullable=False),
        sa.Column("regular_count", sa.SmallInteger(), nullable=False),
        sa.Column("strong_min_value", sa.SmallInteger(), nullable=True),
        sa.Column("strong_max_value", sa.SmallInteger(), nullable=True),
        sa.Column("strong_count", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("effective_end_date IS NULL OR effective_end_date >= effective_start_date", name="ck_game_rules_effective_range"),
        sa.CheckConstraint("regular_min_value >= 1", name="ck_game_rules_regular_min"),
        sa.CheckConstraint("regular_max_value > regular_min_value", name="ck_game_rules_regular_max"),
        sa.CheckConstraint("regular_count > 0", name="ck_game_rules_regular_count"),
        sa.CheckConstraint(
            "(strong_count = 0 AND strong_min_value IS NULL AND strong_max_value IS NULL) OR "
            "(strong_count > 0 AND strong_min_value IS NOT NULL AND strong_max_value IS NOT NULL AND strong_max_value > strong_min_value)",
            name="ck_game_rules_strong_config",
        ),
        sa.PrimaryKeyConstraint("game_rule_id"),
        sa.UniqueConstraint("game_code", "game_variant", "rule_version", name="uq_game_rules_identity"),
    )
    op.create_index("ix_game_rules_lookup", "game_rules", ["game_code", "game_variant", "effective_start_date"], unique=False)

    op.create_table(
        "data_import_logs",
        sa.Column("import_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("source_object", sa.String(length=256), nullable=False),
        sa.Column("source_checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("records_received", sa.Integer(), nullable=False),
        sa.Column("records_valid", sa.Integer(), nullable=False),
        sa.Column("records_quarantined", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("started_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("triggered_by", sa.String(length=80), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("records_received >= 0", name="ck_import_records_received"),
        sa.CheckConstraint("records_valid >= 0", name="ck_import_records_valid"),
        sa.CheckConstraint("records_quarantined >= 0", name="ck_import_records_quarantined"),
        sa.CheckConstraint("status IN ('running','succeeded','partial','failed')", name="ck_import_status"),
        sa.CheckConstraint("ended_at_utc IS NULL OR ended_at_utc >= started_at_utc", name="ck_import_time_range"),
        sa.PrimaryKeyConstraint("import_id"),
        sa.UniqueConstraint("run_id", "source_system", "source_object", name="uq_import_run_source"),
    )
    op.create_index("ix_import_checksum", "data_import_logs", ["source_checksum_sha256"], unique=False)
    op.create_index("ix_import_status_time", "data_import_logs", ["status", "started_at_utc"], unique=False)

    op.create_table(
        "lottery_draws",
        sa.Column("draw_revision_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("draw_uid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("import_id", sa.BigInteger(), nullable=False),
        sa.Column("game_rule_id", sa.BigInteger(), nullable=False),
        sa.Column("supersedes_draw_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("draw_number", sa.Integer(), nullable=False),
        sa.Column("draw_date", sa.Date(), nullable=False),
        sa.Column("draw_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("source_record_id", sa.String(length=128), nullable=False),
        sa.Column("source_revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("jackpot_amount", sa.Numeric(precision=16, scale=2), nullable=True),
        sa.Column("currency_code", sa.String(length=3), server_default=sa.text("'ILS'"), nullable=False),
        sa.Column("is_current", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("effective_from_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("effective_to_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("record_checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("ingested_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("draw_number > 0", name="ck_draw_number_positive"),
        sa.CheckConstraint("source_revision >= 1", name="ck_draw_source_revision_positive"),
        sa.CheckConstraint("jackpot_amount IS NULL OR jackpot_amount >= 0", name="ck_draw_jackpot_non_negative"),
        sa.CheckConstraint("effective_to_utc IS NULL OR effective_to_utc > effective_from_utc", name="ck_draw_effective_range"),
        sa.ForeignKeyConstraint(["game_rule_id"], ["game_rules.game_rule_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["import_id"], ["data_import_logs.import_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["supersedes_draw_revision_id"], ["lottery_draws.draw_revision_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("draw_revision_id"),
        sa.UniqueConstraint("source_system", "source_record_id", "source_revision", name="uq_draw_source_revision"),
    )
    op.create_index("ix_draw_lookup", "lottery_draws", ["game_rule_id", "draw_date"], unique=False)
    op.create_index(
        "ix_draw_current_lookup",
        "lottery_draws",
        ["game_rule_id", "draw_date", "draw_number"],
        unique=False,
        postgresql_where=sa.text("is_current = true"),
    )
    op.create_index(
        "uq_draw_current_version",
        "lottery_draws",
        ["game_rule_id", "draw_date", "draw_number"],
        unique=True,
        postgresql_where=sa.text("is_current = true"),
    )
    op.create_index("ix_draw_uid", "lottery_draws", ["draw_uid", "source_revision"], unique=False)

    op.create_table(
        "draw_numbers",
        sa.Column("draw_number_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("draw_revision_id", sa.BigInteger(), nullable=False),
        sa.Column("position_no", sa.SmallInteger(), nullable=False),
        sa.Column("number_value", sa.SmallInteger(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("position_no >= 1", name="ck_draw_numbers_position_min"),
        sa.CheckConstraint("number_value >= 1", name="ck_draw_numbers_value_min"),
        sa.ForeignKeyConstraint(["draw_revision_id"], ["lottery_draws.draw_revision_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("draw_number_id"),
        sa.UniqueConstraint("draw_revision_id", "number_value", name="uq_draw_regular_value"),
        sa.UniqueConstraint("draw_revision_id", "position_no", name="uq_draw_regular_position"),
    )
    op.create_index("ix_draw_numbers_value", "draw_numbers", ["number_value", "draw_revision_id"], unique=False)

    op.create_table(
        "strong_numbers",
        sa.Column("strong_number_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("draw_revision_id", sa.BigInteger(), nullable=False),
        sa.Column("position_no", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        sa.Column("strong_value", sa.SmallInteger(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("position_no = 1", name="ck_strong_single_slot_phase1"),
        sa.CheckConstraint("strong_value >= 1", name="ck_strong_value_min"),
        sa.ForeignKeyConstraint(["draw_revision_id"], ["lottery_draws.draw_revision_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("strong_number_id"),
        sa.UniqueConstraint("draw_revision_id", "position_no", name="uq_draw_strong_position"),
        sa.UniqueConstraint("draw_revision_id", "strong_value", name="uq_draw_strong_value"),
    )
    op.create_index("ix_strong_value", "strong_numbers", ["strong_value", "draw_revision_id"], unique=False)

    op.create_table(
        "analytics_snapshots",
        sa.Column("snapshot_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("snapshot_code", sa.String(length=64), nullable=False),
        sa.Column("game_rule_id", sa.BigInteger(), nullable=False),
        sa.Column("snapshot_type", sa.String(length=24), nullable=False),
        sa.Column("window_start_date", sa.Date(), nullable=False),
        sa.Column("window_end_date", sa.Date(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=32), nullable=False),
        sa.Column("engine_build_id", sa.String(length=64), nullable=False),
        sa.Column("execution_manifest_jsonb", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dataset_hash_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_watermark_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("quality_score", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("published_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("window_end_date >= window_start_date", name="ck_snapshot_window"),
        sa.CheckConstraint("quality_score >= 0 AND quality_score <= 100", name="ck_snapshot_quality"),
        sa.CheckConstraint("status IN ('draft','published','superseded','failed')", name="ck_snapshot_status"),
        sa.ForeignKeyConstraint(["game_rule_id"], ["game_rules.game_rule_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("snapshot_id"),
        sa.UniqueConstraint(
            "game_rule_id",
            "window_start_date",
            "window_end_date",
            "algorithm_version",
            "dataset_hash_sha256",
            name="uq_snapshot_content",
        ),
        sa.UniqueConstraint("snapshot_code", name="uq_snapshot_code"),
    )
    op.create_index("ix_snapshot_publish", "analytics_snapshots", ["status", "published_at_utc"], unique=False)
    op.create_index(
        "uq_snapshot_published_once",
        "analytics_snapshots",
        ["game_rule_id", "window_start_date", "window_end_date", "algorithm_version"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
    )

    op.create_table(
        "snapshot_import_lineage",
        sa.Column("snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("import_id", sa.BigInteger(), nullable=False),
        sa.Column("linked_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["import_id"], ["data_import_logs.import_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["snapshot_id"], ["analytics_snapshots.snapshot_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("snapshot_id", "import_id"),
    )

    op.create_table(
        "number_frequency",
        sa.Column("snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("number_value", sa.SmallInteger(), nullable=False),
        sa.Column("draw_count", sa.Integer(), nullable=False),
        sa.Column("appearance_count", sa.Integer(), nullable=False),
        sa.Column("frequency_pct", sa.Numeric(precision=7, scale=4), nullable=False),
        sa.Column("recency_days", sa.Integer(), nullable=False),
        sa.Column("z_score", sa.Numeric(precision=10, scale=5), nullable=True),
        sa.Column("quality_score", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.CheckConstraint("number_value >= 1", name="ck_number_frequency_value_min"),
        sa.CheckConstraint("draw_count >= 0", name="ck_number_frequency_draw_count"),
        sa.CheckConstraint("appearance_count >= 0", name="ck_number_frequency_appearance_count"),
        sa.CheckConstraint("frequency_pct >= 0 AND frequency_pct <= 100", name="ck_number_frequency_pct"),
        sa.CheckConstraint("recency_days >= 0", name="ck_number_frequency_recency"),
        sa.CheckConstraint("quality_score >= 0 AND quality_score <= 100", name="ck_number_frequency_quality"),
        sa.ForeignKeyConstraint(["snapshot_id"], ["analytics_snapshots.snapshot_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("snapshot_id", "number_value"),
    )
    op.create_index("ix_number_frequency_rank", "number_frequency", ["snapshot_id", "frequency_pct"], unique=False)
    op.create_index(
        "ix_number_frequency_recency",
        "number_frequency",
        ["snapshot_id", "recency_days", "frequency_pct"],
        unique=False,
    )

    op.create_table(
        "pair_frequency",
        sa.Column("snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("number_a", sa.SmallInteger(), nullable=False),
        sa.Column("number_b", sa.SmallInteger(), nullable=False),
        sa.Column("cooccurrence_count", sa.Integer(), nullable=False),
        sa.Column("support_pct", sa.Numeric(precision=7, scale=4), nullable=False),
        sa.Column("lift_score", sa.Numeric(precision=12, scale=6), nullable=True),
        sa.Column("quality_score", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.CheckConstraint("number_a >= 1", name="ck_pair_frequency_number_a_min"),
        sa.CheckConstraint("number_b >= 1", name="ck_pair_frequency_number_b_min"),
        sa.CheckConstraint("number_a < number_b", name="ck_pair_frequency_order"),
        sa.CheckConstraint("cooccurrence_count >= 0", name="ck_pair_frequency_cooccurrence"),
        sa.CheckConstraint("support_pct >= 0 AND support_pct <= 100", name="ck_pair_frequency_support"),
        sa.CheckConstraint("lift_score IS NULL OR lift_score >= 0", name="ck_pair_frequency_lift"),
        sa.CheckConstraint("quality_score >= 0 AND quality_score <= 100", name="ck_pair_frequency_quality"),
        sa.ForeignKeyConstraint(["snapshot_id"], ["analytics_snapshots.snapshot_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("snapshot_id", "number_a", "number_b"),
    )
    op.create_index("ix_pair_frequency_support", "pair_frequency", ["snapshot_id", "support_pct"], unique=False)

    op.create_table(
        "data_import_rejections",
        sa.Column("rejection_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("import_id", sa.BigInteger(), nullable=False),
        sa.Column("source_pointer", sa.String(length=256), nullable=False),
        sa.Column("rejection_code", sa.String(length=64), nullable=False),
        sa.Column("rejection_detail", sa.Text(), nullable=True),
        sa.Column("rejected_payload_hash", sa.String(length=64), nullable=False),
        sa.Column("resolution_status", sa.String(length=16), server_default=sa.text("'open'"), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "resolution_status IN ('open','resolved','ignored')",
            name="ck_import_rejection_resolution_status",
        ),
        sa.ForeignKeyConstraint(["import_id"], ["data_import_logs.import_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("rejection_id"),
    )
    op.create_index("ix_import_rejections_code", "data_import_rejections", ["rejection_code"], unique=False)
    op.create_index("ix_import_rejections_import", "data_import_rejections", ["import_id", "created_at_utc"], unique=False)

    op.create_table(
        "system_audit_logs",
        sa.Column("audit_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("event_ts_utc", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor_type", sa.String(length=16), nullable=False),
        sa.Column("actor_id", sa.String(length=128), nullable=False),
        sa.Column("actor_role", sa.String(length=64), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("before_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("severity", sa.String(length=8), nullable=False),
        sa.Column("retention_until_date", sa.Date(), nullable=False),
        sa.CheckConstraint("actor_type IN ('user','service','system')", name="ck_audit_actor_type"),
        sa.CheckConstraint("result IN ('success','failure','denied')", name="ck_audit_result"),
        sa.CheckConstraint("severity IN ('info','warn','error','critical')", name="ck_audit_severity"),
        sa.PrimaryKeyConstraint("audit_id"),
    )
    op.create_index("ix_audit_event_time", "system_audit_logs", ["event_ts_utc"], unique=False)
    op.create_index("ix_audit_actor_time", "system_audit_logs", ["actor_id", "event_ts_utc"], unique=False)
    op.create_index("ix_audit_entity_time", "system_audit_logs", ["entity_type", "entity_id", "event_ts_utc"], unique=False)
    op.create_index("ix_audit_request", "system_audit_logs", ["request_id"], unique=False)

    # Rule-based integrity trigger for Israeli Lotto draw validity.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_lottery_draw_integrity(draw_id BIGINT)
        RETURNS VOID AS $$
        DECLARE
            rule_row RECORD;
            regular_total INTEGER;
            strong_total INTEGER;
            bad_regular_values INTEGER;
            bad_strong_values INTEGER;
        BEGIN
            SELECT
                gr.regular_min_value,
                gr.regular_max_value,
                gr.regular_count,
                gr.strong_min_value,
                gr.strong_max_value,
                gr.strong_count
            INTO rule_row
            FROM lottery_draws ld
            JOIN game_rules gr ON gr.game_rule_id = ld.game_rule_id
            WHERE ld.draw_revision_id = draw_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Draw % does not exist for validation', draw_id;
            END IF;

            SELECT COUNT(*) INTO regular_total
            FROM draw_numbers
            WHERE draw_revision_id = draw_id;

            IF regular_total <> rule_row.regular_count THEN
                RAISE EXCEPTION 'Draw % regular number count mismatch: expected %, got %',
                    draw_id, rule_row.regular_count, regular_total;
            END IF;

            SELECT COUNT(*) INTO bad_regular_values
            FROM draw_numbers
            WHERE draw_revision_id = draw_id
              AND (number_value < rule_row.regular_min_value OR number_value > rule_row.regular_max_value);

            IF bad_regular_values > 0 THEN
                RAISE EXCEPTION 'Draw % has regular numbers outside allowed range', draw_id;
            END IF;

            SELECT COUNT(*) INTO strong_total
            FROM strong_numbers
            WHERE draw_revision_id = draw_id;

            IF strong_total <> rule_row.strong_count THEN
                RAISE EXCEPTION 'Draw % strong number count mismatch: expected %, got %',
                    draw_id, rule_row.strong_count, strong_total;
            END IF;

            IF rule_row.strong_count > 0 THEN
                SELECT COUNT(*) INTO bad_strong_values
                FROM strong_numbers
                WHERE draw_revision_id = draw_id
                  AND (strong_value < rule_row.strong_min_value OR strong_value > rule_row.strong_max_value);

                IF bad_strong_values > 0 THEN
                    RAISE EXCEPTION 'Draw % has strong numbers outside allowed range', draw_id;
                END IF;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION trg_validate_lottery_draw_integrity()
        RETURNS TRIGGER AS $$
        DECLARE
            v_draw_id BIGINT;
        BEGIN
            v_draw_id := COALESCE(NEW.draw_revision_id, OLD.draw_revision_id);
            PERFORM validate_lottery_draw_integrity(v_draw_id);
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
        CREATE CONSTRAINT TRIGGER ct_validate_draw_numbers_integrity
        AFTER INSERT OR UPDATE OR DELETE ON draw_numbers
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION trg_validate_lottery_draw_integrity();
        """
    )

    op.execute(
        """
        CREATE CONSTRAINT TRIGGER ct_validate_strong_numbers_integrity
        AFTER INSERT OR UPDATE OR DELETE ON strong_numbers
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION trg_validate_lottery_draw_integrity();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS ct_validate_strong_numbers_integrity ON strong_numbers;")
    op.execute("DROP TRIGGER IF EXISTS ct_validate_draw_numbers_integrity ON draw_numbers;")
    op.execute("DROP FUNCTION IF EXISTS trg_validate_lottery_draw_integrity();")
    op.execute("DROP FUNCTION IF EXISTS validate_lottery_draw_integrity(BIGINT);")

    op.drop_index("ix_audit_request", table_name="system_audit_logs")
    op.drop_index("ix_audit_entity_time", table_name="system_audit_logs")
    op.drop_index("ix_audit_actor_time", table_name="system_audit_logs")
    op.drop_index("ix_audit_event_time", table_name="system_audit_logs")
    op.drop_table("system_audit_logs")

    op.drop_index("ix_import_rejections_import", table_name="data_import_rejections")
    op.drop_index("ix_import_rejections_code", table_name="data_import_rejections")
    op.drop_table("data_import_rejections")

    op.drop_index("ix_pair_frequency_support", table_name="pair_frequency")
    op.drop_table("pair_frequency")

    op.drop_index("ix_number_frequency_recency", table_name="number_frequency")
    op.drop_index("ix_number_frequency_rank", table_name="number_frequency")
    op.drop_table("number_frequency")

    op.drop_table("snapshot_import_lineage")

    op.drop_index("uq_snapshot_published_once", table_name="analytics_snapshots")
    op.drop_index("ix_snapshot_publish", table_name="analytics_snapshots")
    op.drop_table("analytics_snapshots")

    op.drop_index("ix_strong_value", table_name="strong_numbers")
    op.drop_table("strong_numbers")

    op.drop_index("ix_draw_numbers_value", table_name="draw_numbers")
    op.drop_table("draw_numbers")

    op.drop_index("ix_draw_uid", table_name="lottery_draws")
    op.drop_index("uq_draw_current_version", table_name="lottery_draws")
    op.drop_index("ix_draw_current_lookup", table_name="lottery_draws")
    op.drop_index("ix_draw_lookup", table_name="lottery_draws")
    op.drop_table("lottery_draws")

    op.drop_index("ix_import_status_time", table_name="data_import_logs")
    op.drop_index("ix_import_checksum", table_name="data_import_logs")
    op.drop_table("data_import_logs")

    op.drop_index("ix_game_rules_lookup", table_name="game_rules")
    op.drop_table("game_rules")

