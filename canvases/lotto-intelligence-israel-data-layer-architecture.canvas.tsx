import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Stack,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

type ColumnDef = {
  column: string;
  dataType: string;
  constraints: string;
};

type IndexDef = {
  indexName: string;
  indexType: string;
  columns: string;
  purpose: string;
};

const schemaLayers = [
  {
    schema: "li_core",
    purpose: "Canonical draw facts, revision history, normalized draw numbers.",
    tables: "lottery_draws, draw_numbers, strong_numbers",
  },
  {
    schema: "li_analytics",
    purpose: "Derived aggregates and snapshot-managed statistics.",
    tables: "analytics_snapshots, number_frequency, pair_frequency, triplet_frequency",
  },
  {
    schema: "li_ops",
    purpose: "Operational ingestion and auditability metadata.",
    tables: "data_import_logs, system_audit_logs",
  },
];

const erdRelationships = [
  {
    relationship: "lottery_draws 1 -> N draw_numbers",
    fk: "draw_numbers.draw_revision_id -> lottery_draws.draw_revision_id",
    rule: "ON DELETE CASCADE; ON UPDATE RESTRICT",
  },
  {
    relationship: "lottery_draws 1 -> N strong_numbers",
    fk: "strong_numbers.draw_revision_id -> lottery_draws.draw_revision_id",
    rule: "ON DELETE CASCADE; ON UPDATE RESTRICT",
  },
  {
    relationship: "analytics_snapshots 1 -> N number_frequency",
    fk: "number_frequency.snapshot_id -> analytics_snapshots.snapshot_id",
    rule: "ON DELETE CASCADE; ON UPDATE RESTRICT",
  },
  {
    relationship: "analytics_snapshots 1 -> N pair_frequency",
    fk: "pair_frequency.snapshot_id -> analytics_snapshots.snapshot_id",
    rule: "ON DELETE CASCADE; ON UPDATE RESTRICT",
  },
  {
    relationship: "analytics_snapshots 1 -> N triplet_frequency",
    fk: "triplet_frequency.snapshot_id -> analytics_snapshots.snapshot_id",
    rule: "ON DELETE CASCADE; ON UPDATE RESTRICT",
  },
  {
    relationship: "data_import_logs N -> 1 lottery_draws (lineage)",
    fk: "lottery_draws.import_id -> data_import_logs.import_id",
    rule: "ON DELETE RESTRICT; ON UPDATE RESTRICT",
  },
];

const lotteryDrawsColumns: ColumnDef[] = [
  { column: "draw_revision_id", dataType: "BIGSERIAL", constraints: "PRIMARY KEY" },
  { column: "draw_uid", dataType: "UUID", constraints: "NOT NULL; stable business identifier across revisions" },
  { column: "import_id", dataType: "BIGINT", constraints: "NOT NULL; FK to li_ops.data_import_logs(import_id)" },
  { column: "game_code", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "game_variant", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "rule_version", dataType: "VARCHAR(32)", constraints: "NOT NULL; effective game rule set id" },
  { column: "draw_number", dataType: "INTEGER", constraints: "NOT NULL; CHECK (draw_number > 0)" },
  { column: "draw_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "draw_timestamp_utc", dataType: "TIMESTAMPTZ", constraints: "NULL allowed if source omits exact time" },
  { column: "source_system", dataType: "VARCHAR(64)", constraints: "NOT NULL" },
  { column: "source_record_id", dataType: "VARCHAR(128)", constraints: "NOT NULL" },
  { column: "source_revision", dataType: "INTEGER", constraints: "NOT NULL DEFAULT 1; CHECK (source_revision >= 1)" },
  { column: "jackpot_amount", dataType: "NUMERIC(16,2)", constraints: "NULL allowed; CHECK (jackpot_amount >= 0)" },
  { column: "currency_code", dataType: "CHAR(3)", constraints: "NOT NULL DEFAULT 'ILS'" },
  { column: "is_current", dataType: "BOOLEAN", constraints: "NOT NULL DEFAULT TRUE" },
  { column: "effective_from_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
  { column: "effective_to_utc", dataType: "TIMESTAMPTZ", constraints: "NULL for current version" },
  { column: "record_checksum_sha256", dataType: "CHAR(64)", constraints: "NOT NULL" },
  { column: "ingested_at_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
];

const lotteryDrawsIndexes: IndexDef[] = [
  {
    indexName: "pk_lottery_draws",
    indexType: "BTREE (PK)",
    columns: "draw_revision_id",
    purpose: "Primary row access",
  },
  {
    indexName: "uq_draw_source_revision",
    indexType: "UNIQUE BTREE",
    columns: "source_system, source_record_id, source_revision",
    purpose: "Prevents duplicate source revisions",
  },
  {
    indexName: "uq_draw_current_version",
    indexType: "UNIQUE BTREE (partial)",
    columns: "game_code, game_variant, draw_date, draw_number WHERE is_current = TRUE",
    purpose: "Single active canonical revision per draw",
  },
  {
    indexName: "ix_draw_lookup",
    indexType: "BTREE",
    columns: "game_code, game_variant, draw_date DESC",
    purpose: "Primary draw retrieval path",
  },
  {
    indexName: "ix_draw_uid",
    indexType: "BTREE",
    columns: "draw_uid, source_revision DESC",
    purpose: "Revision history retrieval",
  },
];

const drawNumbersColumns: ColumnDef[] = [
  { column: "draw_number_id", dataType: "BIGSERIAL", constraints: "PRIMARY KEY" },
  { column: "draw_revision_id", dataType: "BIGINT", constraints: "NOT NULL; FK to li_core.lottery_draws(draw_revision_id)" },
  { column: "position_no", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (position_no BETWEEN 1 AND 20)" },
  { column: "number_value", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_value BETWEEN 1 AND 99)" },
  { column: "number_kind", dataType: "VARCHAR(16)", constraints: "NOT NULL DEFAULT 'regular'; CHECK (number_kind = 'regular')" },
  { column: "created_at_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
];

const drawNumbersIndexes: IndexDef[] = [
  {
    indexName: "pk_draw_numbers",
    indexType: "BTREE (PK)",
    columns: "draw_number_id",
    purpose: "Primary row access",
  },
  {
    indexName: "uq_draw_regular_position",
    indexType: "UNIQUE BTREE",
    columns: "draw_revision_id, position_no",
    purpose: "Single number per position",
  },
  {
    indexName: "uq_draw_regular_value",
    indexType: "UNIQUE BTREE",
    columns: "draw_revision_id, number_value",
    purpose: "No duplicate regular numbers in same draw",
  },
  {
    indexName: "ix_draw_numbers_value",
    indexType: "BTREE",
    columns: "number_value, draw_revision_id",
    purpose: "Fast historical number scans",
  },
];

const strongNumbersColumns: ColumnDef[] = [
  { column: "strong_number_id", dataType: "BIGSERIAL", constraints: "PRIMARY KEY" },
  { column: "draw_revision_id", dataType: "BIGINT", constraints: "NOT NULL; FK to li_core.lottery_draws(draw_revision_id)" },
  { column: "position_no", dataType: "SMALLINT", constraints: "NOT NULL DEFAULT 1; CHECK (position_no BETWEEN 1 AND 5)" },
  { column: "strong_value", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (strong_value BETWEEN 1 AND 99)" },
  { column: "created_at_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
];

const strongNumbersIndexes: IndexDef[] = [
  {
    indexName: "pk_strong_numbers",
    indexType: "BTREE (PK)",
    columns: "strong_number_id",
    purpose: "Primary row access",
  },
  {
    indexName: "uq_draw_strong_position",
    indexType: "UNIQUE BTREE",
    columns: "draw_revision_id, position_no",
    purpose: "Single strong number per strong slot",
  },
  {
    indexName: "uq_draw_strong_value",
    indexType: "UNIQUE BTREE",
    columns: "draw_revision_id, strong_value",
    purpose: "No duplicate strong numbers in same draw revision",
  },
  {
    indexName: "ix_strong_value",
    indexType: "BTREE",
    columns: "strong_value, draw_revision_id",
    purpose: "Strong number trend retrieval",
  },
];

const analyticsSnapshotsColumns: ColumnDef[] = [
  { column: "snapshot_id", dataType: "BIGSERIAL", constraints: "PRIMARY KEY" },
  { column: "snapshot_code", dataType: "VARCHAR(64)", constraints: "NOT NULL; unique human-readable batch id" },
  { column: "snapshot_type", dataType: "VARCHAR(24)", constraints: "NOT NULL; e.g. daily, backfill, ad_hoc" },
  { column: "game_code", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "game_variant", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "rule_version", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "window_start_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "window_end_date", dataType: "DATE", constraints: "NOT NULL; CHECK (window_end_date >= window_start_date)" },
  { column: "algorithm_version", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "dataset_hash_sha256", dataType: "CHAR(64)", constraints: "NOT NULL" },
  { column: "source_watermark_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL" },
  { column: "quality_score", dataType: "NUMERIC(5,2)", constraints: "NOT NULL; CHECK (quality_score BETWEEN 0 AND 100)" },
  { column: "status", dataType: "VARCHAR(16)", constraints: "NOT NULL; CHECK (status IN ('draft','published','superseded','failed'))" },
  { column: "created_by", dataType: "VARCHAR(80)", constraints: "NOT NULL" },
  { column: "created_at_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
  { column: "published_at_utc", dataType: "TIMESTAMPTZ", constraints: "NULL until published" },
];

const analyticsSnapshotsIndexes: IndexDef[] = [
  {
    indexName: "pk_analytics_snapshots",
    indexType: "BTREE (PK)",
    columns: "snapshot_id",
    purpose: "Primary row access",
  },
  {
    indexName: "uq_snapshot_code",
    indexType: "UNIQUE BTREE",
    columns: "snapshot_code",
    purpose: "Unique snapshot batch id",
  },
  {
    indexName: "uq_snapshot_content",
    indexType: "UNIQUE BTREE",
    columns: "game_code, game_variant, rule_version, window_start_date, window_end_date, algorithm_version, dataset_hash_sha256",
    purpose: "Prevents duplicate analytics outputs",
  },
  {
    indexName: "ix_snapshot_publish",
    indexType: "BTREE",
    columns: "status, published_at_utc DESC",
    purpose: "Fast published snapshot discovery",
  },
];

const numberFrequencyColumns: ColumnDef[] = [
  { column: "snapshot_id", dataType: "BIGINT", constraints: "NOT NULL; FK to li_analytics.analytics_snapshots(snapshot_id)" },
  { column: "game_code", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "game_variant", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "window_start_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "window_end_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "number_value", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_value BETWEEN 1 AND 99)" },
  { column: "draw_count", dataType: "INTEGER", constraints: "NOT NULL; CHECK (draw_count >= 0)" },
  { column: "appearance_count", dataType: "INTEGER", constraints: "NOT NULL; CHECK (appearance_count >= 0)" },
  { column: "frequency_pct", dataType: "NUMERIC(7,4)", constraints: "NOT NULL; CHECK (frequency_pct BETWEEN 0 AND 100)" },
  { column: "recency_days", dataType: "INTEGER", constraints: "NOT NULL; CHECK (recency_days >= 0)" },
  { column: "z_score", dataType: "NUMERIC(10,5)", constraints: "NULL allowed for small sample windows" },
  { column: "quality_score", dataType: "NUMERIC(5,2)", constraints: "NOT NULL; CHECK (quality_score BETWEEN 0 AND 100)" },
];

const numberFrequencyIndexes: IndexDef[] = [
  {
    indexName: "pk_number_frequency",
    indexType: "BTREE (composite PK)",
    columns: "snapshot_id, game_code, game_variant, number_value",
    purpose: "Uniqueness and snapshot retrieval",
  },
  {
    indexName: "ix_number_freq_window",
    indexType: "BTREE",
    columns: "game_code, game_variant, window_start_date, window_end_date",
    purpose: "Time-window analytics access",
  },
  {
    indexName: "ix_number_freq_rank",
    indexType: "BTREE",
    columns: "snapshot_id, frequency_pct DESC",
    purpose: "Top/bottom frequency ranking queries",
  },
];

const pairFrequencyColumns: ColumnDef[] = [
  { column: "snapshot_id", dataType: "BIGINT", constraints: "NOT NULL; FK to li_analytics.analytics_snapshots(snapshot_id)" },
  { column: "game_code", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "game_variant", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "window_start_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "window_end_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "number_a", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_a BETWEEN 1 AND 99)" },
  { column: "number_b", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_b BETWEEN 1 AND 99)" },
  { column: "cooccurrence_count", dataType: "INTEGER", constraints: "NOT NULL; CHECK (cooccurrence_count >= 0)" },
  { column: "support_pct", dataType: "NUMERIC(7,4)", constraints: "NOT NULL; CHECK (support_pct BETWEEN 0 AND 100)" },
  { column: "lift_score", dataType: "NUMERIC(12,6)", constraints: "NULL allowed; CHECK (lift_score IS NULL OR lift_score >= 0)" },
  { column: "quality_score", dataType: "NUMERIC(5,2)", constraints: "NOT NULL; CHECK (quality_score BETWEEN 0 AND 100)" },
];

const pairFrequencyIndexes: IndexDef[] = [
  {
    indexName: "pk_pair_frequency",
    indexType: "BTREE (composite PK)",
    columns: "snapshot_id, game_code, game_variant, number_a, number_b",
    purpose: "Uniqueness and snapshot retrieval",
  },
  {
    indexName: "ck_pair_order",
    indexType: "CHECK constraint (logical index aid)",
    columns: "number_a < number_b",
    purpose: "Canonical pair ordering avoids duplicate permutations",
  },
  {
    indexName: "ix_pair_support",
    indexType: "BTREE",
    columns: "snapshot_id, support_pct DESC",
    purpose: "Top co-occurrence queries",
  },
];

const tripletFrequencyColumns: ColumnDef[] = [
  { column: "snapshot_id", dataType: "BIGINT", constraints: "NOT NULL; FK to li_analytics.analytics_snapshots(snapshot_id)" },
  { column: "game_code", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "game_variant", dataType: "VARCHAR(32)", constraints: "NOT NULL" },
  { column: "window_start_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "window_end_date", dataType: "DATE", constraints: "NOT NULL" },
  { column: "number_a", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_a BETWEEN 1 AND 99)" },
  { column: "number_b", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_b BETWEEN 1 AND 99)" },
  { column: "number_c", dataType: "SMALLINT", constraints: "NOT NULL; CHECK (number_c BETWEEN 1 AND 99)" },
  { column: "cooccurrence_count", dataType: "INTEGER", constraints: "NOT NULL; CHECK (cooccurrence_count >= 0)" },
  { column: "support_pct", dataType: "NUMERIC(7,4)", constraints: "NOT NULL; CHECK (support_pct BETWEEN 0 AND 100)" },
  { column: "quality_score", dataType: "NUMERIC(5,2)", constraints: "NOT NULL; CHECK (quality_score BETWEEN 0 AND 100)" },
];

const tripletFrequencyIndexes: IndexDef[] = [
  {
    indexName: "pk_triplet_frequency",
    indexType: "BTREE (composite PK)",
    columns: "snapshot_id, game_code, game_variant, number_a, number_b, number_c",
    purpose: "Uniqueness and snapshot retrieval",
  },
  {
    indexName: "ck_triplet_order",
    indexType: "CHECK constraint (logical index aid)",
    columns: "number_a < number_b AND number_b < number_c",
    purpose: "Canonical triplet ordering avoids permutation duplication",
  },
  {
    indexName: "ix_triplet_support",
    indexType: "BTREE",
    columns: "snapshot_id, support_pct DESC",
    purpose: "Top triplet query acceleration",
  },
];

const dataImportLogsColumns: ColumnDef[] = [
  { column: "import_id", dataType: "BIGSERIAL", constraints: "PRIMARY KEY" },
  { column: "run_id", dataType: "UUID", constraints: "NOT NULL" },
  { column: "source_system", dataType: "VARCHAR(64)", constraints: "NOT NULL" },
  { column: "source_object", dataType: "VARCHAR(256)", constraints: "NOT NULL; file/api endpoint identifier" },
  { column: "source_checksum_sha256", dataType: "CHAR(64)", constraints: "NOT NULL" },
  { column: "records_received", dataType: "INTEGER", constraints: "NOT NULL; CHECK (records_received >= 0)" },
  { column: "records_valid", dataType: "INTEGER", constraints: "NOT NULL; CHECK (records_valid >= 0)" },
  { column: "records_quarantined", dataType: "INTEGER", constraints: "NOT NULL; CHECK (records_quarantined >= 0)" },
  { column: "status", dataType: "VARCHAR(16)", constraints: "NOT NULL; CHECK (status IN ('running','succeeded','partial','failed'))" },
  { column: "error_summary", dataType: "TEXT", constraints: "NULL when no error" },
  { column: "started_at_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL" },
  { column: "ended_at_utc", dataType: "TIMESTAMPTZ", constraints: "NULL while running; CHECK (ended_at_utc IS NULL OR ended_at_utc >= started_at_utc)" },
  { column: "triggered_by", dataType: "VARCHAR(80)", constraints: "NOT NULL; system or operator id" },
  { column: "created_at_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
];

const dataImportLogsIndexes: IndexDef[] = [
  {
    indexName: "pk_data_import_logs",
    indexType: "BTREE (PK)",
    columns: "import_id",
    purpose: "Primary row access",
  },
  {
    indexName: "uq_import_run_source",
    indexType: "UNIQUE BTREE",
    columns: "run_id, source_system, source_object",
    purpose: "Prevents duplicate ingestion run entries",
  },
  {
    indexName: "ix_import_status_time",
    indexType: "BTREE",
    columns: "status, started_at_utc DESC",
    purpose: "Operational pipeline monitoring",
  },
  {
    indexName: "ix_import_checksum",
    indexType: "BTREE",
    columns: "source_checksum_sha256",
    purpose: "Detect repeat source payloads",
  },
];

const systemAuditLogsColumns: ColumnDef[] = [
  { column: "audit_id", dataType: "BIGSERIAL", constraints: "PRIMARY KEY" },
  { column: "event_ts_utc", dataType: "TIMESTAMPTZ", constraints: "NOT NULL DEFAULT now()" },
  { column: "actor_type", dataType: "VARCHAR(16)", constraints: "NOT NULL; CHECK (actor_type IN ('user','service','system'))" },
  { column: "actor_id", dataType: "VARCHAR(128)", constraints: "NOT NULL" },
  { column: "actor_role", dataType: "VARCHAR(64)", constraints: "NULL for non-user actors" },
  { column: "action", dataType: "VARCHAR(64)", constraints: "NOT NULL" },
  { column: "entity_type", dataType: "VARCHAR(64)", constraints: "NOT NULL" },
  { column: "entity_id", dataType: "VARCHAR(128)", constraints: "NOT NULL" },
  { column: "request_id", dataType: "UUID", constraints: "NULL allowed for async jobs" },
  { column: "source_ip", dataType: "INET", constraints: "NULL allowed for internal jobs" },
  { column: "user_agent", dataType: "TEXT", constraints: "NULL allowed" },
  { column: "before_state", dataType: "JSONB", constraints: "NULL allowed; redacted policy fields only" },
  { column: "after_state", dataType: "JSONB", constraints: "NULL allowed; redacted policy fields only" },
  { column: "result", dataType: "VARCHAR(16)", constraints: "NOT NULL; CHECK (result IN ('success','failure','denied'))" },
  { column: "severity", dataType: "VARCHAR(8)", constraints: "NOT NULL; CHECK (severity IN ('info','warn','error','critical'))" },
  { column: "retention_until_date", dataType: "DATE", constraints: "NOT NULL" },
];

const systemAuditLogsIndexes: IndexDef[] = [
  {
    indexName: "pk_system_audit_logs",
    indexType: "BTREE (PK)",
    columns: "audit_id",
    purpose: "Primary row access",
  },
  {
    indexName: "ix_audit_event_time_brin",
    indexType: "BRIN",
    columns: "event_ts_utc",
    purpose: "High-volume time-range scans with low storage overhead",
  },
  {
    indexName: "ix_audit_actor_time",
    indexType: "BTREE",
    columns: "actor_id, event_ts_utc DESC",
    purpose: "Actor forensic tracing",
  },
  {
    indexName: "ix_audit_entity_time",
    indexType: "BTREE",
    columns: "entity_type, entity_id, event_ts_utc DESC",
    purpose: "Entity-level audit reconstruction",
  },
  {
    indexName: "ix_audit_request",
    indexType: "BTREE",
    columns: "request_id",
    purpose: "Cross-service request correlation",
  },
];

const validationRules = [
  {
    category: "Structural",
    rule: "All mandatory columns non-null; type, format, and enum checks enforced at DB level.",
    implementation: "NOT NULL + CHECK constraints + strict FK relationships",
  },
  {
    category: "Draw integrity",
    rule: "One active draw revision per (game_code, game_variant, draw_date, draw_number); no duplicate number in same draw.",
    implementation: "Partial unique index + per-draw unique constraints in draw_numbers/strong_numbers",
  },
  {
    category: "Rule-version compliance",
    rule: "Numbers must match allowed ranges/counts for rule_version effective on draw date.",
    implementation: "Ingestion validation service plus reject/quarantine path; DB stores rule_version used",
  },
  {
    category: "Chronology",
    rule: "effective_to_utc must be greater than effective_from_utc; import ended_at_utc cannot precede started_at_utc.",
    implementation: "CHECK constraints",
  },
  {
    category: "Analytics consistency",
    rule: "Frequency percentages and support percentages constrained to 0..100 with valid counts.",
    implementation: "CHECK constraints + nightly reconciliation tests",
  },
];

const versioningStrategy = [
  {
    policy: "Bitemporal draw versioning",
    details:
      "Each correction creates new row in lottery_draws with incremented source_revision; previous row closed by effective_to_utc and is_current=FALSE.",
    outcome: "Complete historical traceability and point-in-time reconstruction.",
  },
  {
    policy: "Stable business key",
    details:
      "draw_uid remains constant for all revisions of same logical draw; draw_revision_id changes per version.",
    outcome: "Easy join between current state and revision history.",
  },
  {
    policy: "Snapshot immutability",
    details:
      "analytics_snapshots rows are immutable once published; corrections generate new snapshot_id.",
    outcome: "Reproducible analytics outputs and audit-friendly lineage.",
  },
  {
    policy: "Dataset fingerprinting",
    details:
      "dataset_hash_sha256 and source watermark captured for each snapshot.",
    outcome: "Byte-level reproducibility validation.",
  },
];

const dqMonitoring = [
  {
    metric: "Completeness",
    definition: "Expected draws vs ingested draws by game/date window",
    threshold: "Critical if < 99.9% for active monitored window",
    action: "Block snapshot publication; open incident",
  },
  {
    metric: "Uniqueness",
    definition: "Duplicate source rows and duplicate active draw keys",
    threshold: "Critical if > 0",
    action: "Quarantine offending records; require operator approval",
  },
  {
    metric: "Validity",
    definition: "Out-of-range values, invalid combinations, malformed records",
    threshold: "High if > 0.1% invalid in import batch",
    action: "Mark import partial/failed; alert data on-call",
  },
  {
    metric: "Freshness",
    definition: "Delay from source publish time to successful ingestion",
    threshold: "High if lag exceeds SLA window",
    action: "Escalate ingestion pipeline issue",
  },
  {
    metric: "Reconciliation delta",
    definition: "Mismatch between computed aggregates and direct draw recounts",
    threshold: "Critical if any non-zero mismatch on published snapshot",
    action: "Depublish snapshot and rerun analytics",
  },
];

const backupStrategy = [
  {
    layer: "Primary PostgreSQL",
    approach: "Continuous WAL archiving + nightly full base backup",
    frequency: "WAL near-real-time; base backup every 24h",
    retention: "35 days hot + 12 months cold archive",
    recoveryTarget: "RPO <= 15 minutes; RTO <= 60 minutes",
  },
  {
    layer: "Analytics schema",
    approach: "Daily logical export for snapshot tables plus physical backup coverage",
    frequency: "Every 24h",
    retention: "90 days",
    recoveryTarget: "Point-in-time for core, last-successful for analytics",
  },
  {
    layer: "Audit and import logs",
    approach: "Partition-based backup and monthly immutable archive copies",
    frequency: "Daily backup; monthly immutable seal",
    retention: "7 years compliance retention",
    recoveryTarget: "Forensic reconstruction guaranteed",
  },
  {
    layer: "Validation",
    approach: "Automated restore drills on staging with checksum verification",
    frequency: "Quarterly mandatory simulation",
    retention: "Drill evidence retained 2 years",
    recoveryTarget: "Verified operational recoverability",
  },
];

function TableSection({
  title,
  purpose,
  columns,
  indexes,
}: {
  title: string;
  purpose: string;
  columns: ColumnDef[];
  indexes: IndexDef[];
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={purpose} />
      <CardBody>
        <Stack gap={10}>
          <H3>Columns and Constraints</H3>
          <Table
            columns={[
              { key: "column", title: "Column", align: "left" },
              { key: "dataType", title: "Data Type", align: "left" },
              { key: "constraints", title: "Constraints", align: "left" },
            ]}
            rows={columns}
          />
          <H3>Indexes</H3>
          <Table
            columns={[
              { key: "indexName", title: "Index", align: "left" },
              { key: "indexType", title: "Type", align: "left" },
              { key: "columns", title: "Columns", align: "left" },
              { key: "purpose", title: "Purpose", align: "left" },
            ]}
            rows={indexes}
          />
        </Stack>
      </CardBody>
    </Card>
  );
}

export default function LottoIntelligenceDataLayerArchitecture() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Intelligence Israel - Production Data Layer Architecture</H1>
        <H2>PostgreSQL Design Aligned to Approved SRS and Gap Analysis</H2>
        <Text style={{ color: theme.text.secondary }}>
          Scope: Full PostgreSQL schema, ERD, table definitions, PK/FK strategy, index strategy, data validation, historical versioning, data quality monitoring, and automated backup plan.
        </Text>
        <Stack horizontal gap={8}>
          <Pill tone="info">Production Grade</Pill>
          <Pill tone="warning">Versioned Data</Pill>
          <Pill tone="neutral">Audit-Ready</Pill>
        </Stack>
      </Stack>

      <Divider />

      <Card>
        <CardHeader title="1) Full PostgreSQL Schema" subtitle="Logical schema segmentation and ownership boundaries" />
        <CardBody>
          <Table
            columns={[
              { key: "schema", title: "Schema", align: "left" },
              { key: "purpose", title: "Purpose", align: "left" },
              { key: "tables", title: "Tables", align: "left" },
            ]}
            rows={schemaLayers}
          />
          <Text style={{ color: theme.text.secondary }}>
            Baseline platform standards: UTF-8 encoding, UTC storage for all timestamps, timezone-aware rendering at application edge, and mandatory migration governance.
          </Text>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2) Entity Relationship Diagram (ERD)" subtitle="Relationship matrix and foreign key rules" />
        <CardBody>
          <Table
            columns={[
              { key: "relationship", title: "Relationship", align: "left" },
              { key: "fk", title: "Foreign Key", align: "left" },
              { key: "rule", title: "Referential Rule", align: "left" },
            ]}
            rows={erdRelationships}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3-6) Table Definitions, PK/FK, Constraints, and Index Strategy" subtitle="Detailed physical model per required table" />
        <CardBody>
          <Stack gap={12}>
            <Text>
              Each table below includes purpose, full columns with PostgreSQL data types, constraints, and index plan.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <TableSection
        title="li_core.lottery_draws"
        purpose="Canonical draw facts with revisioned history; one active revision per logical draw."
        columns={lotteryDrawsColumns}
        indexes={lotteryDrawsIndexes}
      />

      <TableSection
        title="li_core.draw_numbers"
        purpose="Normalized regular numbers for each draw revision (one row per number position)."
        columns={drawNumbersColumns}
        indexes={drawNumbersIndexes}
      />

      <TableSection
        title="li_core.strong_numbers"
        purpose="Normalized strong/special numbers for each draw revision."
        columns={strongNumbersColumns}
        indexes={strongNumbersIndexes}
      />

      <TableSection
        title="li_analytics.analytics_snapshots"
        purpose="Immutable metadata for deterministic analytics runs and publication lifecycle."
        columns={analyticsSnapshotsColumns}
        indexes={analyticsSnapshotsIndexes}
      />

      <TableSection
        title="li_analytics.number_frequency"
        purpose="Per-number frequency, recency, and quality metrics tied to a specific analytics snapshot."
        columns={numberFrequencyColumns}
        indexes={numberFrequencyIndexes}
      />

      <TableSection
        title="li_analytics.pair_frequency"
        purpose="Pair co-occurrence aggregate metrics by snapshot and window."
        columns={pairFrequencyColumns}
        indexes={pairFrequencyIndexes}
      />

      <TableSection
        title="li_analytics.triplet_frequency"
        purpose="Triplet co-occurrence aggregate metrics by snapshot and window."
        columns={tripletFrequencyColumns}
        indexes={tripletFrequencyIndexes}
      />

      <TableSection
        title="li_ops.data_import_logs"
        purpose="Ingestion run telemetry, lineage metadata, and quarantine/error accounting."
        columns={dataImportLogsColumns}
        indexes={dataImportLogsIndexes}
      />

      <TableSection
        title="li_ops.system_audit_logs"
        purpose="Compliance-grade security and administrative audit trail."
        columns={systemAuditLogsColumns}
        indexes={systemAuditLogsIndexes}
      />

      <Card>
        <CardHeader title="7) Data Validation Rules" subtitle="Database-enforced and pipeline-enforced controls" />
        <CardBody>
          <Table
            columns={[
              { key: "category", title: "Category", align: "left" },
              { key: "rule", title: "Rule", align: "left" },
              { key: "implementation", title: "Implementation", align: "left" },
            ]}
            rows={validationRules}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="8) Historical Data Versioning Strategy" subtitle="Correction-safe and reproducible model" />
        <CardBody>
          <Table
            columns={[
              { key: "policy", title: "Policy", align: "left" },
              { key: "details", title: "Implementation Details", align: "left" },
              { key: "outcome", title: "Outcome", align: "left" },
            ]}
            rows={versioningStrategy}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="9) Data Quality Monitoring Strategy" subtitle="Operational controls and release gating metrics" />
        <CardBody>
          <Table
            columns={[
              { key: "metric", title: "Metric", align: "left" },
              { key: "definition", title: "Definition", align: "left" },
              { key: "threshold", title: "Threshold", align: "left" },
              { key: "action", title: "Action", align: "left" },
            ]}
            rows={dqMonitoring}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="10) Automated Backup Strategy" subtitle="Recovery posture for production operations" />
        <CardBody>
          <Table
            columns={[
              { key: "layer", title: "Data Layer", align: "left" },
              { key: "approach", title: "Backup Approach", align: "left" },
              { key: "frequency", title: "Frequency", align: "left" },
              { key: "retention", title: "Retention", align: "left" },
              { key: "recoveryTarget", title: "Recovery Target", align: "left" },
            ]}
            rows={backupStrategy}
          />
          <Text style={{ color: theme.text.secondary }}>
            Mandatory operational control: backup integrity checksums and restore tests are release gates for production changes affecting schema or pipelines.
          </Text>
        </CardBody>
      </Card>
    </Stack>
  );
}
