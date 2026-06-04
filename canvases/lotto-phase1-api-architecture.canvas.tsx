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

type Row = Record<string, string>;

const stackRows: Row[] = [
  {
    layer: "Runtime",
    decision: "Python 3.12 + FastAPI + Uvicorn workers behind reverse proxy",
    why: "Mature async stack, excellent OpenAPI support, strong typing and validation via Pydantic v2.",
  },
  {
    layer: "API contract",
    decision: "OpenAPI 3.1 as single source of truth, strict request/response models",
    why: "Prevents contract drift and enables automated client/test generation.",
  },
  {
    layer: "Data access",
    decision: "SQLAlchemy 2.x Core/ORM + Alembic migrations",
    why: "Production-safe transaction management and migration governance for PostgreSQL.",
  },
  {
    layer: "Database",
    decision: "PostgreSQL 16 (primary) + read replica for analytics reads",
    why: "Meets ACID and analytical read requirements for Phase 1 reliability.",
  },
  {
    layer: "Caching",
    decision: "Redis for endpoint result caching and rate-limiting counters",
    why: "Reduces read load and stabilizes latency for dashboard-heavy queries.",
  },
  {
    layer: "Background jobs",
    decision: "Celery/RQ-style worker queue for import processing and snapshot jobs",
    why: "Keeps API response times predictable for long-running imports.",
  },
  {
    layer: "Observability",
    decision: "OpenTelemetry traces + Prometheus metrics + structured JSON logs",
    why: "Supports SLO tracking and rapid incident triage.",
  },
];

const projectStructureRows: Row[] = [
  {
    path: "app/main.py",
    purpose: "FastAPI app bootstrap, middleware chain, router registration.",
  },
  {
    path: "app/api/v1/",
    purpose: "Versioned endpoint routers only for required Phase 1 resources.",
  },
  {
    path: "app/schemas/",
    purpose: "Pydantic request/response contracts and standardized error envelope.",
  },
  {
    path: "app/services/",
    purpose: "Use-case orchestration (draw retrieval, statistics computation, import orchestration).",
  },
  {
    path: "app/repositories/",
    purpose: "Query layer mapped to approved data schema and optimized SQL paths.",
  },
  {
    path: "app/validation/",
    purpose: "Rule-version and semantic validation modules for draw imports.",
  },
  {
    path: "app/imports/",
    purpose: "Import pipeline workflow, staging transforms, and rejection handling.",
  },
  {
    path: "app/monitoring/",
    purpose: "Health probes, metrics emitters, and audit/logging hooks.",
  },
  {
    path: "app/security/",
    purpose: "API key auth, request signing checks, rate-limit guard middleware.",
  },
  {
    path: "tests/",
    purpose: "Contract, integration, performance, and failure-mode tests.",
  },
];

const endpointCatalogRows: Row[] = [
  { method: "GET", url: "/health", purpose: "Liveness/readiness plus dependency status." },
  { method: "GET", url: "/api/v1/draws", purpose: "Paginated draw listing with filtering/sorting." },
  { method: "GET", url: "/api/v1/draws/{draw_id}", purpose: "Single draw details including normalized numbers." },
  { method: "POST", url: "/api/v1/import/draws", purpose: "Trigger import job for source payload reference." },
  { method: "GET", url: "/api/v1/stats/frequency", purpose: "Number frequency and recency metrics by window." },
  { method: "GET", url: "/api/v1/stats/strong-number", purpose: "Strong-number frequency metrics by window." },
  { method: "GET", url: "/api/v1/stats/pairs", purpose: "Top pair co-occurrence metrics by window." },
  { method: "GET", url: "/api/v1/stats/summary", purpose: "High-level statistics summary for dashboard overview." },
];

const commonErrorRows: Row[] = [
  {
    code: "VALIDATION_ERROR",
    status: "400",
    when: "Schema/parameter validation fails.",
    envelope: "{ error_code, message, details[], request_id, timestamp_utc }",
  },
  {
    code: "UNAUTHORIZED",
    status: "401",
    when: "Missing/invalid API key.",
    envelope: "{ error_code, message, request_id, timestamp_utc }",
  },
  {
    code: "FORBIDDEN",
    status: "403",
    when: "Caller lacks import/stat scope.",
    envelope: "{ error_code, message, request_id, timestamp_utc }",
  },
  {
    code: "NOT_FOUND",
    status: "404",
    when: "Resource id not found or superseded non-public revision requested.",
    envelope: "{ error_code, message, request_id, timestamp_utc }",
  },
  {
    code: "CONFLICT",
    status: "409",
    when: "Duplicate import request or snapshot publication conflict.",
    envelope: "{ error_code, message, request_id, timestamp_utc }",
  },
  {
    code: "RATE_LIMITED",
    status: "429",
    when: "Rate limits exceeded.",
    envelope: "{ error_code, message, retry_after_seconds, request_id, timestamp_utc }",
  },
  {
    code: "INTERNAL_ERROR",
    status: "500",
    when: "Unhandled processing failure.",
    envelope: "{ error_code, message, request_id, timestamp_utc }",
  },
  {
    code: "DEPENDENCY_UNAVAILABLE",
    status: "503",
    when: "Database/queue/cache unavailable.",
    envelope: "{ error_code, message, request_id, timestamp_utc }",
  },
];

const paginationRows: Row[] = [
  {
    area: "Pagination model",
    decision: "Cursor pagination for draw listing; no offset pagination for Phase 1.",
    rules: "cursor token encodes (draw_date, draw_number, draw_revision_id), limit default 50 max 200.",
  },
  {
    area: "Filtering model",
    decision: "Allowlist filters only",
    rules: "game_code, game_variant, from_date, to_date, rule_version, is_current.",
  },
  {
    area: "Sorting model",
    decision: "Restricted sortable fields only",
    rules: "draw_date desc default; optional draw_date asc, draw_number desc/asc; reject other fields.",
  },
  {
    area: "Response metadata",
    decision: "Consistent paging envelope",
    rules: "{ items, page_info{next_cursor, has_more}, applied_filters, applied_sort }",
  },
];

const loggingRows: Row[] = [
  {
    category: "Request logs",
    content: "request_id, method, path, status, latency_ms, api_key_id hash, client_ip hash.",
    retention: "30 days hot, 180 days archive.",
  },
  {
    category: "Import logs",
    content: "import_id, source reference, row counts, validation failures, rule version, checksum.",
    retention: "7 years compliance retention.",
  },
  {
    category: "Audit logs",
    content: "action, actor_type, actor_id, resource, result, severity, before/after redacted snapshots.",
    retention: "7 years compliance retention.",
  },
  {
    category: "Security logs",
    content: "auth failures, rate-limit violations, suspicious traffic signatures.",
    retention: "1 year minimum.",
  },
];

const securityRows: Row[] = [
  {
    area: "Authentication",
    approach: "Service API key authentication only (no end-user login in Phase 1).",
    detail: "Key ID + secret, rotated every 90 days, scoped permissions (`read_draws`, `read_stats`, `import_draws`).",
  },
  {
    area: "Transport security",
    approach: "TLS 1.3 mandatory end-to-end.",
    detail: "Reject plaintext and weak ciphers; HSTS on gateway.",
  },
  {
    area: "Input protection",
    approach: "Strict schema validation and parameter allowlists.",
    detail: "Reject unknown fields and disallow free-form sort/filter expressions.",
  },
  {
    area: "Data safety",
    approach: "Educational analytics only policy enforcement.",
    detail: "No recommendation fields in response schema; no endpoint for predictions/gambling advice.",
  },
  {
    area: "Abuse protection",
    approach: "Gateway WAF + anomaly detection + rate limiting.",
    detail: "Automatic temporary blocks on abusive signatures.",
  },
];

const rateLimitRows: Row[] = [
  {
    endpointGroup: "Health",
    limit: "120 req/min per key",
    burst: "30",
    note: "Low cost endpoint; still bounded to prevent abuse.",
  },
  {
    endpointGroup: "Draw reads",
    limit: "300 req/min per key",
    burst: "60",
    note: "Cached reads expected; tuned for dashboard traffic.",
  },
  {
    endpointGroup: "Stats reads",
    limit: "180 req/min per key",
    burst: "40",
    note: "Heavier analytical queries; protect DB and replica.",
  },
  {
    endpointGroup: "Import trigger",
    limit: "6 req/hour per key",
    burst: "2",
    note: "Prevents duplicate ingestion floods.",
  },
];

const testingRows: Row[] = [
  {
    testType: "Contract tests",
    scope: "OpenAPI schema conformance for all 8 endpoints and error envelope.",
    gate: "Blocking for release.",
  },
  {
    testType: "Integration tests",
    scope: "DB + cache + queue integration including import and snapshot lineage.",
    gate: "Blocking for release.",
  },
  {
    testType: "Validation tests",
    scope: "Rule-version, range, count, duplicate, chronology validations.",
    gate: "Blocking for release.",
  },
  {
    testType: "Performance tests",
    scope: "P95 targets: draws <= 300 ms cached, stats <= 700 ms cached, <= 1200 ms uncached.",
    gate: "Blocking for release.",
  },
  {
    testType: "Resilience tests",
    scope: "DB failover behavior, cache miss storms, queue delay, partial dependency outages.",
    gate: "Blocking for go-live.",
  },
  {
    testType: "Security tests",
    scope: "Auth bypass, injection attempts, rate-limit enforcement, sensitive-field exposure.",
    gate: "Blocking for go-live.",
  },
];

const endpointRowsHealth: Row[] = [
  {
    field: "Purpose",
    value: "Expose liveness/readiness for platform and dependency health.",
  },
  {
    field: "Method",
    value: "GET",
  },
  {
    field: "URL",
    value: "/health",
  },
  {
    field: "Query parameters",
    value: "None.",
  },
  {
    field: "Request body",
    value: "None.",
  },
  {
    field: "Response body",
    value:
      "{ status:'ok|degraded|down', service:'lotto-api', version, time_utc, dependencies:{postgres,redis,queue}, uptime_seconds, request_id }",
  },
  {
    field: "Validation rules",
    value: "No input payload; dependency states mapped to strict enum.",
  },
  {
    field: "Error cases",
    value: "503 if core dependency readiness fails; 500 on unexpected probe failure.",
  },
  {
    field: "Performance notes",
    value: "Target P95 <= 100 ms; no heavy DB query (single lightweight ping).",
  },
];

const endpointRowsDraws: Row[] = [
  {
    field: "Purpose",
    value: "List draw records for educational historical analysis.",
  },
  { field: "Method", value: "GET" },
  { field: "URL", value: "/api/v1/draws" },
  {
    field: "Query parameters",
    value:
      "game_code(required), game_variant(optional), rule_version(optional), from_date(optional), to_date(optional), is_current(default true), limit(default 50 max 200), cursor(optional), sort(default draw_date:desc).",
  },
  { field: "Request body", value: "None." },
  {
    field: "Response body",
    value:
      "{ items:[{ draw_id, draw_uid, draw_date, draw_number, game_code, game_variant, rule_version, jackpot_amount, currency_code, is_current }], page_info:{next_cursor,has_more}, applied_filters, applied_sort, request_id }",
  },
  {
    field: "Validation rules",
    value:
      "from_date <= to_date; date window <= 10 years in Phase 1; sort allowlist only; limit bounds; cursor signature integrity check.",
  },
  {
    field: "Error cases",
    value:
      "400 invalid filters/sort/cursor, 401/403 auth scope failure, 429 rate limited, 503 dependency unavailable.",
  },
  {
    field: "Performance notes",
    value:
      "Uses partial current-draw index and cursor pagination; target P95 <= 300 ms cached and <= 800 ms uncached.",
  },
];

const endpointRowsDrawById: Row[] = [
  { field: "Purpose", value: "Fetch one draw with normalized numbers and lineage fields." },
  { field: "Method", value: "GET" },
  { field: "URL", value: "/api/v1/draws/{draw_id}" },
  { field: "Query parameters", value: "include_revision_history(optional boolean default false)." },
  { field: "Request body", value: "None." },
  {
    field: "Response body",
    value:
      "{ draw:{ draw_id, draw_uid, draw_date, draw_number, game_code, game_variant, rule_version, jackpot_amount, source_system, source_revision, is_current }, regular_numbers:[...], strong_numbers:[...], revision_history?:[{draw_revision_id,effective_from_utc,effective_to_utc}], request_id }",
  },
  {
    field: "Validation rules",
    value: "draw_id must be positive integer; include_revision_history strict boolean only.",
  },
  {
    field: "Error cases",
    value: "404 draw not found, 400 invalid id, 401/403 auth errors, 429 rate limited.",
  },
  {
    field: "Performance notes",
    value: "Single draw lookup + indexed child joins; target P95 <= 250 ms.",
  },
];

const endpointRowsImport: Row[] = [
  { field: "Purpose", value: "Trigger controlled draw import job from approved source reference." },
  { field: "Method", value: "POST" },
  { field: "URL", value: "/api/v1/import/draws" },
  { field: "Query parameters", value: "dry_run(optional boolean default false)." },
  {
    field: "Request body",
    value:
      "{ source_system, source_object, source_checksum_sha256(optional), expected_record_count(optional), import_mode:'incremental|backfill', from_date(optional), to_date(optional), triggered_by }",
  },
  {
    field: "Response body",
    value:
      "202 Accepted: { import_id, run_id, status:'accepted', submitted_at_utc, estimated_completion_s, request_id }",
  },
  {
    field: "Validation rules",
    value:
      "source_system/source_object required; date range required for backfill; max backfill window 365 days per request; checksum format if provided.",
  },
  {
    field: "Error cases",
    value:
      "400 invalid payload/date window, 403 missing `import_draws` scope, 409 duplicate active import, 429 import rate limit, 503 queue unavailable.",
  },
  {
    field: "Performance notes",
    value: "Non-blocking endpoint; synchronous processing budget <= 150 ms before queue handoff.",
  },
];

const endpointRowsFrequency: Row[] = [
  { field: "Purpose", value: "Return per-number frequency/recency metrics for selected window." },
  { field: "Method", value: "GET" },
  { field: "URL", value: "/api/v1/stats/frequency" },
  {
    field: "Query parameters",
    value:
      "game_code(required), game_variant(optional), rule_version(optional), window_start(required), window_end(required), top_n(optional default 10 max 50), include_zscore(optional default true), sort(default frequency_desc).",
  },
  { field: "Request body", value: "None." },
  {
    field: "Response body",
    value:
      "{ snapshot_id, window:{start,end}, metrics:[{ number_value, appearance_count, draw_count, frequency_pct, recency_days, z_score?, quality_score }], disclaimer, request_id }",
  },
  {
    field: "Validation rules",
    value:
      "window_start <= window_end; max window 10 years; top_n bounds; sort allowlist only; must match existing/published snapshot context.",
  },
  {
    field: "Error cases",
    value: "400 invalid params, 404 snapshot/window unavailable, 429 rate limited, 503 dependency unavailable.",
  },
  {
    field: "Performance notes",
    value: "Served from materialized frequency table + Redis cache; target P95 <= 700 ms cached.",
  },
];

const endpointRowsStrong: Row[] = [
  { field: "Purpose", value: "Return strong-number frequency metrics for selected game window." },
  { field: "Method", value: "GET" },
  { field: "URL", value: "/api/v1/stats/strong-number" },
  {
    field: "Query parameters",
    value:
      "game_code(required), game_variant(optional), rule_version(optional), window_start(required), window_end(required), top_n(optional default 10 max 30).",
  },
  { field: "Request body", value: "None." },
  {
    field: "Response body",
    value:
      "{ snapshot_id, window:{start,end}, strong_metrics:[{ strong_value, appearance_count, frequency_pct, recency_days, quality_score }], disclaimer, request_id }",
  },
  {
    field: "Validation rules",
    value:
      "Strong-number endpoints only for variants supporting strong numbers; reject unsupported variants with 400.",
  },
  {
    field: "Error cases",
    value: "400 invalid/unsupported variant, 404 snapshot not found, 429 rate limited, 503 dependency unavailable.",
  },
  {
    field: "Performance notes",
    value: "Indexed strong-number aggregate lookup; target P95 <= 650 ms cached.",
  },
];

const endpointRowsPairs: Row[] = [
  { field: "Purpose", value: "Return top pair co-occurrence metrics for educational analysis." },
  { field: "Method", value: "GET" },
  { field: "URL", value: "/api/v1/stats/pairs" },
  {
    field: "Query parameters",
    value:
      "game_code(required), game_variant(optional), rule_version(optional), window_start(required), window_end(required), top_n(optional default 20 max 100), min_support_pct(optional default 0), sort(default support_desc).",
  },
  { field: "Request body", value: "None." },
  {
    field: "Response body",
    value:
      "{ snapshot_id, window:{start,end}, pair_metrics:[{ number_a, number_b, cooccurrence_count, support_pct, lift_score, quality_score }], disclaimer, request_id }",
  },
  {
    field: "Validation rules",
    value: "min_support_pct within 0..100; top_n bounds; window validity; published snapshot requirement.",
  },
  {
    field: "Error cases",
    value: "400 invalid params, 404 snapshot unavailable, 429 rate limited, 503 dependency unavailable.",
  },
  {
    field: "Performance notes",
    value: "Reads from pair_frequency with ranking index; target P95 <= 800 ms cached.",
  },
];

const endpointRowsSummary: Row[] = [
  { field: "Purpose", value: "Provide dashboard-level summary statistics for chosen window." },
  { field: "Method", value: "GET" },
  { field: "URL", value: "/api/v1/stats/summary" },
  {
    field: "Query parameters",
    value:
      "game_code(required), game_variant(optional), rule_version(optional), window_start(required), window_end(required).",
  },
  { field: "Request body", value: "None." },
  {
    field: "Response body",
    value:
      "{ snapshot_id, summary:{ total_draws, latest_draw_date, most_frequent_numbers:[...], least_frequent_numbers:[...], most_frequent_strong_numbers:[...], top_pairs:[...] }, quality:{ snapshot_quality_score, data_freshness_utc }, disclaimer, request_id }",
  },
  {
    field: "Validation rules",
    value: "Window and variant validation as above; all summary components must be sourced from same snapshot_id.",
  },
  {
    field: "Error cases",
    value: "400 invalid params, 404 no published snapshot for window, 429 rate limited, 503 dependency unavailable.",
  },
  {
    field: "Performance notes",
    value:
      "Fan-in read from frequency/pair/strong aggregates under single snapshot; target P95 <= 900 ms cached and <= 1500 ms uncached.",
  },
];

const monitoringRows: Row[] = [
  {
    endpoint: "GET /health",
    type: "Readiness/liveness probe",
    note: "Required endpoint; includes dependency status map.",
  },
  {
    endpoint: "GET /health?scope=live",
    type: "Liveness mode via query flag",
    note: "Lightweight process-only probe for orchestration restarts.",
  },
  {
    endpoint: "GET /health?scope=ready",
    type: "Readiness mode via query flag",
    note: "Checks PostgreSQL, Redis, queue connection readiness.",
  },
];

export default function LottoPhase1ApiArchitecture() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Intelligence Israel - Phase 1 MVP API Architecture</H1>
        <H2>Final Production-Grade Backend Design (Single Approach)</H2>
        <Text style={{ color: theme.text.secondary }}>
          Scope constrained to educational and analytical statistics APIs only. No user login endpoints. No gambling recommendation capabilities.
        </Text>
        <Stack horizontal gap={8}>
          <Pill tone="info">Phase 1 MVP</Pill>
          <Pill tone="warning">Educational Analytics Only</Pill>
          <Pill tone="danger">No Recommendation APIs</Pill>
        </Stack>
      </Stack>

      <Divider />

      <Card>
        <CardHeader title="1) Backend Technology Stack" subtitle="Selected production stack for Phase 1" />
        <CardBody>
          <Table
            columns={[
              { key: "layer", title: "Layer", align: "left" },
              { key: "decision", title: "Final Decision", align: "left" },
              { key: "why", title: "Rationale", align: "left" },
            ]}
            rows={stackRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2) FastAPI Project Structure" subtitle="Boundary-oriented backend layout" />
        <CardBody>
          <Table
            columns={[
              { key: "path", title: "Path", align: "left" },
              { key: "purpose", title: "Purpose", align: "left" },
            ]}
            rows={projectStructureRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3) API Endpoint List" subtitle="Only required Phase 1 endpoints" />
        <CardBody>
          <Table
            columns={[
              { key: "method", title: "Method", align: "left" },
              { key: "url", title: "URL", align: "left" },
              { key: "purpose", title: "Purpose", align: "left" },
            ]}
            rows={endpointCatalogRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="4-6) Schemas, Validation, and Error Handling Strategy" subtitle="Cross-endpoint standards" />
        <CardBody>
          <Stack gap={10}>
            <H3>Standard Response Envelopes</H3>
            <Text>
              Success envelope standard: payload fields + `request_id` + `generated_at_utc` + `disclaimer` for statistics endpoints.
            </Text>
            <Text>
              Error envelope standard: `error_code`, `message`, optional `details[]`, `request_id`, `timestamp_utc`.
            </Text>
            <H3>Error Code Registry</H3>
            <Table
              columns={[
                { key: "code", title: "Error Code", align: "left" },
                { key: "status", title: "HTTP", align: "left" },
                { key: "when", title: "When Used", align: "left" },
                { key: "envelope", title: "Response Shape", align: "left" },
              ]}
              rows={commonErrorRows}
            />
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="7) Pagination, Filtering, and Sorting Strategy" subtitle="Deterministic query behavior" />
        <CardBody>
          <Table
            columns={[
              { key: "area", title: "Area", align: "left" },
              { key: "decision", title: "Decision", align: "left" },
              { key: "rules", title: "Rules", align: "left" },
            ]}
            rows={paginationRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="8-10) Data Import, Analytics, and Monitoring Endpoint Designs" subtitle="Per-endpoint production contracts" />
        <CardBody>
          <Stack gap={12}>
            <H3>GET /health</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsHealth} />

            <H3>GET /api/v1/draws</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsDraws} />

            <H3>GET /api/v1/draws/{`{draw_id}`}</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsDrawById} />

            <H3>POST /api/v1/import/draws</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsImport} />

            <H3>GET /api/v1/stats/frequency</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsFrequency} />

            <H3>GET /api/v1/stats/strong-number</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsStrong} />

            <H3>GET /api/v1/stats/pairs</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsPairs} />

            <H3>GET /api/v1/stats/summary</H3>
            <Table columns={[{ key: "field", title: "Contract Element", align: "left" }, { key: "value", title: "Definition", align: "left" }]} rows={endpointRowsSummary} />
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="11) Logging Strategy" subtitle="Structured and compliance-aware logging" />
        <CardBody>
          <Table
            columns={[
              { key: "category", title: "Log Category", align: "left" },
              { key: "content", title: "Required Fields", align: "left" },
              { key: "retention", title: "Retention", align: "left" },
            ]}
            rows={loggingRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="12) Security Approach" subtitle="Phase 1 controls without user-login feature scope" />
        <CardBody>
          <Table
            columns={[
              { key: "area", title: "Security Area", align: "left" },
              { key: "approach", title: "Approach", align: "left" },
              { key: "detail", title: "Implementation Detail", align: "left" },
            ]}
            rows={securityRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="13) Rate Limiting Approach" subtitle="Endpoint-class limits for database protection" />
        <CardBody>
          <Table
            columns={[
              { key: "endpointGroup", title: "Endpoint Group", align: "left" },
              { key: "limit", title: "Limit", align: "left" },
              { key: "burst", title: "Burst", align: "left" },
              { key: "note", title: "Operational Note", align: "left" },
            ]}
            rows={rateLimitRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="14) Testing Strategy" subtitle="Release gating for production readiness" />
        <CardBody>
          <Table
            columns={[
              { key: "testType", title: "Test Type", align: "left" },
              { key: "scope", title: "Scope", align: "left" },
              { key: "gate", title: "Release Gate", align: "left" },
            ]}
            rows={testingRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Health and Monitoring Endpoint Notes" subtitle="No extra endpoints added beyond required list" />
        <CardBody>
          <Table
            columns={[
              { key: "endpoint", title: "Endpoint", align: "left" },
              { key: "type", title: "Type", align: "left" },
              { key: "note", title: "Note", align: "left" },
            ]}
            rows={monitoringRows}
          />
          <Text style={{ color: theme.text.secondary }}>
            Monitoring detail is implemented through scoped behavior on `GET /health` query flags; no additional route surfaces are introduced in Phase 1.
          </Text>
        </CardBody>
      </Card>
    </Stack>
  );
}
