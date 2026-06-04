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

type Issue = {
  check: string;
  problem: string;
  risk: string;
  correction: string;
  priority: string;
};

const issues: Issue[] = [
  {
    check: "1) Endpoint completeness",
    problem:
      "Phase 1 import workflow has only trigger endpoint and no status contract in the required set.",
    risk:
      "Clients cannot confirm import outcome deterministically, reducing operational reliability and audit usability.",
    correction:
      "Keep endpoint set unchanged but require `POST /api/v1/import/draws` to return `import_id` and define asynchronous completion through data layer visibility and audit logs as formal contract behavior.",
    priority: "High",
  },
  {
    check: "2) Unnecessary endpoint surface",
    problem:
      "Monitoring section introduces `GET /health?scope=live|ready` despite endpoint contract saying no query parameters.",
    risk:
      "Contract ambiguity and test inconsistency between API docs and implementation.",
    correction:
      "Standardize `GET /health` with optional `scope` query in the formal endpoint contract and validation table, or remove scope completely. For Phase 1 best approach: keep `scope` and document it consistently.",
    priority: "Medium",
  },
  {
    check: "3) Schema correctness",
    problem:
      "`GET /api/v1/draws/{draw_id}` returns `draw_id` but data model is revisioned; identity semantics are underdefined (`draw_uid` vs `draw_revision_id`).",
    risk:
      "Consumers may cache and reference unstable identifiers, causing wrong draw retrieval after corrections.",
    correction:
      "Define `draw_id` in API as immutable `draw_uid`; expose `draw_revision_id` separately in payload for lineage.",
    priority: "Critical",
  },
  {
    check: "3) Schema correctness",
    problem:
      "Stats schemas omit mandatory reproducibility metadata from approved data review (`algorithm_version`, `engine_build_id`, execution manifest reference).",
    risk:
      "Published analytics cannot be independently reproduced or audited.",
    correction:
      "Add to all stats responses: `snapshot_id`, `algorithm_version`, `engine_build_id`, `dataset_hash_sha256`, and `data_quality_score`.",
    priority: "Critical",
  },
  {
    check: "4) Validation gaps",
    problem:
      "Request validation does not enforce rule-catalog compatibility for `game_code`, `game_variant`, `rule_version`, and date window.",
    risk:
      "Requests may query impossible combinations and return misleading analytics.",
    correction:
      "Add strict cross-field validation against `game_rules` effective-date windows before query execution.",
    priority: "Critical",
  },
  {
    check: "4) Validation gaps",
    problem:
      "Import payload validation lacks idempotency key requirement.",
    risk:
      "Duplicate import submissions can create concurrent ingestion races and unnecessary load.",
    correction:
      "Require `Idempotency-Key` header for `POST /api/v1/import/draws`; return same accepted response for retries within TTL.",
    priority: "High",
  },
  {
    check: "5) Error handling gaps",
    problem:
      "Error model does not distinguish invalid rule/date combinations from generic validation errors.",
    risk:
      "Clients cannot implement precise recovery behavior and operators lose actionable diagnostics.",
    correction:
      "Introduce explicit `RULE_CONFLICT` (422) and `SNAPSHOT_NOT_PUBLISHED` (409/404 based on policy) codes with structured details.",
    priority: "Medium",
  },
  {
    check: "5) Error handling gaps",
    problem:
      "No contract for partial success in import (accepted but with validation rejections).",
    risk:
      "Import quality may appear healthy while rejected rows silently reduce completeness.",
    correction:
      "Define terminal import statuses and include `records_valid`, `records_quarantined`, and rejection summary in import result observability contract.",
    priority: "High",
  },
  {
    check: "6) Pagination/filtering/sorting risks",
    problem:
      "Cursor format is not versioned or signed in schema contract.",
    risk:
      "Cursor tampering and backward-incompatibility during deployments can break paging.",
    correction:
      "Use opaque signed cursor with version prefix; reject mismatched version with deterministic 400 error.",
    priority: "Medium",
  },
  {
    check: "6) Pagination/filtering/sorting risks",
    problem:
      "Sorting contract allows `draw_number` but does not specify stable tie-breakers.",
    risk:
      "Pagination drift and duplicate/missing rows across pages.",
    correction:
      "Enforce stable sort chain: primary requested sort + `draw_revision_id` as deterministic tie-breaker.",
    priority: "High",
  },
  {
    check: "7) Import API safety/auditability",
    problem:
      "Import request body includes `triggered_by` supplied by client.",
    risk:
      "Audit spoofing risk because actor identity can be forged.",
    correction:
      "Derive actor identity from authenticated API key metadata; remove `triggered_by` from client payload.",
    priority: "Critical",
  },
  {
    check: "7) Import API safety/auditability",
    problem:
      "Import API does not require source licensing reference or approved source registry binding.",
    risk:
      "Ingestion from unauthorized sources violates legal/compliance requirements.",
    correction:
      "Validate `source_system` and `source_object` against approved licensed-source registry before accepting job.",
    priority: "Critical",
  },
  {
    check: "8) Analytics performance risks",
    problem:
      "`/stats/summary` fan-in can trigger multiple heavy reads without strict snapshot pinning and cache key design.",
    risk:
      "High latency spikes and inconsistent components from mixed snapshots.",
    correction:
      "Pin all summary subqueries to one published `snapshot_id` and cache by full parameter signature including snapshot version.",
    priority: "High",
  },
  {
    check: "8) Analytics performance risks",
    problem:
      "No explicit timeout/circuit-breaker policy for stats endpoints.",
    risk:
      "Replica degradation can cascade into thread exhaustion and API instability.",
    correction:
      "Set per-endpoint DB timeout budgets, circuit-breaker fallback, and controlled 503 behavior with retry hints.",
    priority: "High",
  },
  {
    check: "9) Logging/monitoring gaps",
    problem:
      "Monitoring design relies only on `/health`; no explicit metric list/SLO mapping per endpoint.",
    risk:
      "Production incidents may be detected late without endpoint-level error-rate and latency telemetry.",
    correction:
      "Define mandatory metrics: request count, p95 latency, error rate, cache hit ratio, import acceptance/failure rate, and snapshot freshness lag.",
    priority: "High",
  },
  {
    check: "9) Logging/monitoring gaps",
    problem:
      "Logs strategy does not require correlation of import jobs to analytics snapshots.",
    risk:
      "Root-cause tracing for stale or inconsistent analytics is difficult.",
    correction:
      "Include `import_id` and `snapshot_id` correlation fields in structured logs for stats and import workflows.",
    priority: "Medium",
  },
  {
    check: "10) Security/rate-limit gaps",
    problem:
      "API key model lacks key scope segregation by environment and explicit key revocation SLA.",
    risk:
      "Compromised key can remain valid too long across environments.",
    correction:
      "Enforce environment-scoped keys, immediate revocation (<5 min propagation), and mandatory rotation policy with alerting.",
    priority: "High",
  },
  {
    check: "10) Security/rate-limit gaps",
    problem:
      "Rate limiting is only per key; no IP and global circuit limits defined.",
    risk:
      "Distributed abuse across many keys can still overload infrastructure.",
    correction:
      "Apply layered limits: per-key, per-IP, and global endpoint budget with adaptive throttling.",
    priority: "High",
  },
  {
    check: "11) Test coverage gaps",
    problem:
      "Test strategy does not explicitly include backward-compatibility checks for OpenAPI non-breaking changes.",
    risk:
      "Minor release can break existing consumers unexpectedly.",
    correction:
      "Add contract-diff gate that blocks breaking schema/behavior changes in Phase 1.",
    priority: "Medium",
  },
  {
    check: "11) Test coverage gaps",
    problem:
      "No explicit deterministic replay tests for analytics responses from same snapshot and parameters.",
    risk:
      "Non-deterministic outputs can undermine trust and compliance.",
    correction:
      "Add replay determinism tests asserting byte-stable sorted payloads for identical inputs.",
    priority: "High",
  },
  {
    check: "12) Database consistency",
    problem:
      "API still assumes availability of `triplet_frequency` in architecture context even though approved DB review defers triplets.",
    risk:
      "Implementation mismatch and wasted engineering effort.",
    correction:
      "Keep required endpoint list unchanged and ensure `/stats/pairs` + `/stats/summary` rely only on `number_frequency`, `pair_frequency`, and strong aggregates; no triplet dependency in Phase 1.",
    priority: "High",
  },
  {
    check: "12) Database consistency",
    problem:
      "Stats responses do not explicitly expose data quality score/freshness despite approved data quality monitoring requirements.",
    risk:
      "Consumers cannot evaluate reliability of returned analytics.",
    correction:
      "Make `data_quality_score`, `source_watermark_utc`, and `snapshot_status` mandatory in all statistics endpoint responses.",
    priority: "High",
  },
];

const finalRecommendation = [
  {
    component: "Endpoint surface",
    recommendation:
      "Keep exactly the required eight endpoints. Standardize `GET /health` with documented optional `scope` query, and keep all other routes unchanged.",
    impact: "Meets MVP scope constraints while removing contract ambiguity.",
  },
  {
    component: "Identifier and schema contract",
    recommendation:
      "Define `draw_id` as immutable `draw_uid`; always return `draw_revision_id` as lineage. Require stats responses to include snapshot reproducibility metadata and quality fields.",
    impact: "Aligns API with revisioned data model and audit-grade reproducibility.",
  },
  {
    component: "Validation and safety",
    recommendation:
      "Enforce rule-catalog validation on all draw/stats requests and licensed-source validation on import. Require idempotency key for import and remove client-supplied `triggered_by`.",
    impact: "Prevents invalid analytics and audit spoofing; strengthens legal/compliance posture.",
  },
  {
    component: "Error and paging discipline",
    recommendation:
      "Adopt explicit domain error codes (`RULE_CONFLICT`, `SNAPSHOT_NOT_PUBLISHED`) and signed versioned cursors with deterministic tie-break sorting.",
    impact: "Improves client recoverability and pagination correctness.",
  },
  {
    component: "Performance and observability",
    recommendation:
      "Pin summary and stats to one published snapshot, enforce per-endpoint timeouts/circuit breaking, and mandate endpoint/SLO metrics with import-snapshot correlation IDs.",
    impact: "Reduces latency instability and accelerates incident diagnosis.",
  },
  {
    component: "Security and rate limiting",
    recommendation:
      "Use environment-scoped API keys with rapid revocation and layered throttling (per-key, per-IP, global). Keep no user-login and no recommendation features.",
    impact: "Production-safe access control and abuse resistance within Phase 1 constraints.",
  },
  {
    component: "Testing gates",
    recommendation:
      "Add OpenAPI compatibility diff gate and deterministic replay tests for stats endpoints in addition to existing contract/performance/security tests.",
    impact: "Prevents breaking changes and non-deterministic analytics regressions.",
  },
];

export default function LottoPhase1ApiProductionReview() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Phase 1 API - Production Readiness Review</H1>
        <H2>Principal Backend Reviewer Assessment (FastAPI)</H2>
        <Text style={{ color: theme.text.secondary }}>
          Strict review against approved SRS, gap analysis, data architecture, and data production review.
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
          title="Final Corrected Phase 1 API Design Recommendation"
          subtitle="One best professional approach"
        />
        <CardBody>
          <Table
            columns={[
              { key: "component", title: "Design Component", align: "left" },
              { key: "recommendation", title: "Final Recommendation", align: "left" },
              { key: "impact", title: "Production Impact", align: "left" },
            ]}
            rows={finalRecommendation}
          />
          <Stack gap={6}>
            <H3>Final Sign-off Position</H3>
            <Text>
              Approve Phase 1 API development only after implementing all Critical and High corrections above. This preserves the exact MVP endpoint scope while making the API contract auditable, deterministic, secure, and consistent with the approved database design.
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
