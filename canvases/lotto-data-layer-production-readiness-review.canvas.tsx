import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  H2,
  H3,
  Pill,
  Stack,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

type IssueRow = {
  check: string;
  problem: string;
  risk: string;
  correction: string;
  priority: string;
};

const issues: IssueRow[] = [
  {
    check: "1) Normalization",
    problem:
      "`number_frequency`, `pair_frequency`, and `triplet_frequency` duplicate dimensional columns (`game_code`, `game_variant`, `window_start_date`, `window_end_date`) already represented by `analytics_snapshots`.",
    risk:
      "Update anomalies, inconsistent analytics rows within same snapshot, and larger index/storage footprint.",
    correction:
      "For Phase 1, keep these tables keyed by `snapshot_id` + number dimensions only; move game/window attributes to `analytics_snapshots` and expose through joins/views.",
    priority: "High",
  },
  {
    check: "2) Derived analytics persistence",
    problem:
      "Triplet persistence is defined up front without demonstrated query demand for MVP.",
    risk:
      "Write amplification, large table growth, and unnecessary maintenance overhead before user value is proven.",
    correction:
      "For Phase 1, persist `number_frequency` and `pair_frequency` only; compute triplets offline on-demand and defer `triplet_frequency` table to Phase 2.",
    priority: "High",
  },
  {
    check: "3) Rows vs arrays",
    problem:
      "Draw numbers are correctly modeled as rows, but no DB-level check enforces required count of regular numbers per draw.",
    risk:
      "Incomplete draws can pass constraints and poison downstream analytics.",
    correction:
      "Add deferred constraint trigger validating exact regular-number count by (`game_code`,`game_variant`,`rule_version`) at transaction commit.",
    priority: "Critical",
  },
  {
    check: "4) Invalid draw prevention",
    problem:
      "`draw_numbers.number_value BETWEEN 1 AND 99` and strong range checks are static, not rule-version specific.",
    risk:
      "Historical Israeli Lotto rule changes cannot be enforced at the DB boundary; invalid historical combinations may be accepted.",
    correction:
      "Introduce `game_rules` master table and enforce rule-specific ranges/counts through ingestion validation plus deferred FK-backed rule checks.",
    priority: "Critical",
  },
  {
    check: "4) Invalid draw prevention",
    problem:
      "`lottery_draws` lacks explicit CHECK for `(effective_to_utc IS NULL OR effective_to_utc > effective_from_utc)`.",
    risk:
      "Broken validity intervals can corrupt point-in-time reconstruction.",
    correction:
      "Add explicit temporal CHECK constraint and reject overlapping active windows for same `draw_uid`.",
    priority: "High",
  },
  {
    check: "5) Query index fitness",
    problem:
      "No index supports most common dashboard query: current draws by date with `is_current=TRUE` including draw number ordering.",
    risk:
      "Frequent dashboard reads may fall back to slower plans under growth.",
    correction:
      "Add partial covering index on `lottery_draws(game_code, game_variant, draw_date DESC, draw_number DESC) WHERE is_current=TRUE`.",
    priority: "High",
  },
  {
    check: "5) Query index fitness",
    problem:
      "No dedicated index for recency/hot-cold dashboard path in `number_frequency` (`snapshot_id`, `recency_days`, `frequency_pct`).",
    risk:
      "Interactive ranking widgets may degrade as analytics rows increase.",
    correction:
      "Add composite index `number_frequency(snapshot_id, recency_days ASC, frequency_pct DESC)`.",
    priority: "Medium",
  },
  {
    check: "6) Israeli Lotto historical rule changes",
    problem:
      "Rule support is string-only (`rule_version`) with no referential model for effective dates, number pools, strong-number rules, and expected counts.",
    risk:
      "No enforceable source of truth for historical correctness across game variants.",
    correction:
      "Add normalized rule catalog (`game_rules`) with effective start/end, regular range, regular count, strong range, strong count; make draws reference immutable rule key.",
    priority: "Critical",
  },
  {
    check: "7) Import auditability",
    problem:
      "`data_import_logs` lacks row-level rejection evidence and replay traceability fields (file line/record pointer, rejection code, payload fingerprint).",
    risk:
      "Cannot perform full forensic replay or explain exactly why records were quarantined.",
    correction:
      "Add `data_import_rejections` table with `import_id`, source pointer, rejection_code, rejection_detail, rejected_payload_hash, and resolution status.",
    priority: "High",
  },
  {
    check: "7) Import auditability",
    problem:
      "No immutable link from analytics snapshots to exact import runs used.",
    risk:
      "Analytics reproducibility is weakened when multiple imports occur close together.",
    correction:
      "Add bridge table `snapshot_import_lineage(snapshot_id, import_id)` populated at snapshot build time.",
    priority: "High",
  },
  {
    check: "8) Snapshot regeneration safety",
    problem:
      "`dataset_hash_sha256` is present, but algorithm parameters and feature flags are not fully modeled.",
    risk:
      "Regeneration can diverge despite same dataset hash due to hidden runtime parameters.",
    correction:
      "Add immutable `execution_manifest_jsonb` (validated schema) and `engine_build_id` columns on `analytics_snapshots`.",
    priority: "High",
  },
  {
    check: "8) Snapshot regeneration safety",
    problem:
      "No explicit publication guard ensuring only one published snapshot per (`game_code`,`game_variant`,`rule_version`,`window`,`algorithm_version`).",
    risk:
      "Concurrent jobs can publish conflicting snapshots.",
    correction:
      "Add partial unique index on published status for the publication key.",
    priority: "High",
  },
  {
    check: "9) Backup and restore practicality",
    problem:
      "RPO 15m with daily base backup is fine, but no explicit PITR retention validation and restore runbook granularity per schema/table class.",
    risk:
      "Recovery targets may be missed during real incident due to procedural gaps.",
    correction:
      "Define tested PITR runbooks (core-first restore, analytics rebuild path, audit-log legal restore path) and monthly restore drills for Phase 1.",
    priority: "High",
  },
  {
    check: "9) Backup and restore practicality",
    problem:
      "Long retention audit tables are specified without explicit partitioning scheme in physical design.",
    risk:
      "Backup/restore time and vacuum overhead increase sharply with growth.",
    correction:
      "Partition `system_audit_logs` and `data_import_logs` by month; archive closed partitions to cheaper storage tier.",
    priority: "Medium",
  },
  {
    check: "10) Phase 1 MVP necessity",
    problem:
      "`triplet_frequency` and full-featured `strong_numbers` multi-slot model are likely over-scoped for initial MVP.",
    risk:
      "Delivery risk and delayed go-live without proportionate Phase 1 user value.",
    correction:
      "For Phase 1, support one strong number slot only (if game requires it) and defer triplet materialization table.",
    priority: "High",
  },
  {
    check: "1/4) Referential integrity",
    problem:
      "`data_import_logs` to `lottery_draws` lineage is one-way; missing strict cascade policy for correction supersession metadata.",
    risk:
      "Orphaned semantic lineage fields may accumulate over iterative corrections.",
    correction:
      "Add explicit supersession columns (`supersedes_draw_revision_id`) with self-FK and non-cyclic constraint policy.",
    priority: "Medium",
  },
];

const finalPhase1Design = [
  {
    component: "Core canonical model",
    recommendation:
      "Keep `lottery_draws`, `draw_numbers`, `strong_numbers` (single-slot strong support in Phase 1), and add `game_rules` as mandatory reference table. Use row-based number storage only; no arrays.",
    rationale:
      "Delivers strict normalization and enforceable historical rule correctness with manageable complexity.",
  },
  {
    component: "Versioning model",
    recommendation:
      "Retain bitemporal revision approach with `draw_uid` + `draw_revision_id`; enforce non-overlapping validity and one active revision per logical draw.",
    rationale:
      "Supports official corrections safely while preserving audit-grade history.",
  },
  {
    component: "Analytics persistence",
    recommendation:
      "Persist `analytics_snapshots`, `number_frequency`, `pair_frequency`; defer `triplet_frequency` table from MVP. Keep analytics fact tables keyed by `snapshot_id` + number dimensions only.",
    rationale:
      "Meets dashboard performance needs while reducing storage and maintenance risk.",
  },
  {
    component: "Audit and import lineage",
    recommendation:
      "Keep `data_import_logs` and `system_audit_logs`, add `data_import_rejections` and `snapshot_import_lineage` for full replayability and forensic traceability.",
    rationale:
      "Closes critical auditability gaps and enables deterministic regeneration evidence.",
  },
  {
    component: "Index and partition plan",
    recommendation:
      "Add partial current-draw index, recency-ranking analytics index, published snapshot uniqueness index, and monthly partitioning for log tables.",
    rationale:
      "Aligns physical design to dashboard query patterns and long-term operational sustainability.",
  },
  {
    component: "Backup and recovery",
    recommendation:
      "Use WAL+PITR with 35-day hot retention, monthly restore drills, schema-class runbooks, and analytics rebuild-first strategy instead of restoring all derived data by default.",
    rationale:
      "Practical, cost-aware recovery model that meets Phase 1 RPO/RTO objectives.",
  },
];

const phase1TablesKeepDrop = [
  {
    table: "lottery_draws",
    phase1Decision: "Keep",
    note: "Core canonical draw revision store",
  },
  {
    table: "draw_numbers",
    phase1Decision: "Keep",
    note: "Normalized regular numbers",
  },
  {
    table: "strong_numbers",
    phase1Decision: "Keep (single-slot support)",
    note: "Only if selected Lotto variant requires strong number",
  },
  {
    table: "analytics_snapshots",
    phase1Decision: "Keep",
    note: "Deterministic analytics lineage anchor",
  },
  {
    table: "number_frequency",
    phase1Decision: "Keep",
    note: "Primary dashboard metric table",
  },
  {
    table: "pair_frequency",
    phase1Decision: "Keep",
    note: "Secondary co-occurrence dashboard metric",
  },
  {
    table: "triplet_frequency",
    phase1Decision: "Defer",
    note: "Phase 2+ after demand validation",
  },
  {
    table: "data_import_logs",
    phase1Decision: "Keep",
    note: "Ingestion telemetry and lineage",
  },
  {
    table: "system_audit_logs",
    phase1Decision: "Keep",
    note: "Compliance and incident forensics",
  },
];

export default function LottoDataLayerReadinessReview() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Data Layer - Production Readiness Review</H1>
        <H2>Principal Database Architect Assessment (PostgreSQL)</H2>
        <Text style={{ color: theme.text.secondary }}>
          Scope: strict pre-development production review across normalization, constraints, indexing, rule versioning, auditability, recoverability, and Phase 1 MVP fit.
        </Text>
        <Stack horizontal gap={8}>
          <Pill tone="danger">Strict Review</Pill>
          <Pill tone="warning">Pre-Development Gate</Pill>
          <Pill tone="info">Single Final Recommendation</Pill>
        </Stack>
      </Stack>

      <Divider />

      <Card>
        <CardHeader
          title="Issue Register"
          subtitle="For each issue: Problem, Risk, Recommended correction, Priority"
        />
        <CardBody>
          <Table
            columns={[
              { key: "check", title: "Checkpoint", align: "left" },
              { key: "problem", title: "Problem", align: "left" },
              { key: "risk", title: "Risk", align: "left" },
              { key: "correction", title: "Recommended Correction", align: "left" },
              { key: "priority", title: "Priority", align: "left" },
            ]}
            rows={issues}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Final Corrected Database Design Recommendation (Phase 1 MVP Only)"
          subtitle="One professional approach selected"
        />
        <CardBody>
          <Table
            columns={[
              { key: "component", title: "Design Component", align: "left" },
              { key: "recommendation", title: "Final Recommendation", align: "left" },
              { key: "rationale", title: "Why This Is Best for Phase 1", align: "left" },
            ]}
            rows={finalPhase1Design}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Phase 1 Table Scope Decision"
          subtitle="Required keep/defer decisions before implementation"
        />
        <CardBody>
          <Table
            columns={[
              { key: "table", title: "Table", align: "left" },
              { key: "phase1Decision", title: "Phase 1 Decision", align: "left" },
              { key: "note", title: "Note", align: "left" },
            ]}
            rows={phase1TablesKeepDrop}
          />
          <Stack gap={6}>
            <H3>Final Sign-off Position</H3>
            <Text>
              Approve development only after implementing all Critical and High corrections above. This yields a normalized, auditable, rule-aware, and recoverable PostgreSQL design that is realistic for Phase 1 delivery.
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
