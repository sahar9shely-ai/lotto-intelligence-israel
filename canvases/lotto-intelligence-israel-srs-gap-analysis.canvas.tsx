import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  H2,
  Pill,
  Stack,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

type GapRow = {
  area: string;
  problem: string;
  why: string;
  fix: string;
  priority: string;
};

const recommendations: GapRow[] = [
  {
    area: "Missing requirements",
    problem:
      "No explicit requirement for source licensing, legal rights, and permitted redistribution of Israeli lottery data.",
    why:
      "A production launch can be blocked or exposed to legal action if data rights are unclear.",
    fix:
      "Add mandatory legal gating: signed source agreement, usage scope, retention/redistribution constraints, and periodic compliance review.",
    priority: "Critical",
  },
  {
    area: "Missing requirements",
    problem:
      "No formal requirement for game-rule versioning (range of numbers, bonus logic, draw cadence, prize tiers) over time.",
    why:
      "Historical analytics become incorrect when rules change and are not versioned by effective date.",
    fix:
      "Introduce a rule catalog with effective_start/effective_end, per game type, and make all stats queries rule-version aware.",
    priority: "Critical",
  },
  {
    area: "Weak technical decisions",
    problem:
      "Architecture commits to polyglot persistence too early for MVP without clear volume-based justification.",
    why:
      "Premature complexity increases delivery risk, operational load, and cost before product-market validation.",
    fix:
      "Start with PostgreSQL plus selective materialized views; defer separate warehouse until measured query pressure justifies split.",
    priority: "High",
  },
  {
    area: "Weak technical decisions",
    problem:
      "Microservice-style domain split is specified before domain boundaries and team topology are stable.",
    why:
      "Over-segmentation in early stage causes slower delivery and distributed-system failure modes.",
    fix:
      "Use modular monolith for Phase 1 with strict internal module boundaries; extract services after performance/team triggers.",
    priority: "High",
  },
  {
    area: "Database risks",
    problem:
      "Using array field `winning_numbers[]` as canonical storage weakens relational constraints and query optimization.",
    why:
      "Validation, indexing, and co-occurrence analytics become harder and can introduce subtle data quality issues.",
    fix:
      "Normalize draw numbers into child table (`draw_numbers`) with one row per position/number and enforced uniqueness constraints.",
    priority: "High",
  },
  {
    area: "Database risks",
    problem:
      "No unique constraints are defined for source duplicates and corrected re-publications.",
    why:
      "Duplicate draws silently pollute statistics and user trust.",
    fix:
      "Define composite uniqueness: source_id + game_type + draw_date + draw_number + source_revision; support superseded records explicitly.",
    priority: "Critical",
  },
  {
    area: "Database risks",
    problem:
      "Retention policy is listed but no physical partitioning/archival strategy is defined.",
    why:
      "Large audit/event tables will degrade performance and increase backup/restore times.",
    fix:
      "Implement time-based partitioning for events/logs, lifecycle policies, and restore-tested archive tiers.",
    priority: "Medium",
  },
  {
    area: "Data validation risks",
    problem:
      "Validation requirements are schema-level only and do not include semantic checks.",
    why:
      "Bad but schema-valid records (invalid ranges, duplicates in draw, impossible bonus combinations) can pass ingestion.",
    fix:
      "Add semantic validation engine: per-rule range checks, uniqueness in draw, draw cadence checks, jackpot sanity checks, and reconciliation thresholds.",
    priority: "Critical",
  },
  {
    area: "Data validation risks",
    problem:
      "No late-arriving correction strategy is defined for historical draw amendments.",
    why:
      "Aggregates can remain stale or contradictory across APIs after source corrections.",
    fix:
      "Implement correction workflow with event-sourced reprocessing, impacted-window recomputation, and data version pinning in API responses.",
    priority: "High",
  },
  {
    area: "Israeli Lotto rules assumptions",
    problem:
      "SRS assumes one generic game structure and does not model game variants or historical format changes.",
    why:
      "Israeli lottery products can differ by number pool, bonus mechanics, and schedule; analytics become misleading if merged blindly.",
    fix:
      "Define explicit `game_definition` model with variant IDs, valid date ranges, number pools, bonus behavior, and per-variant analytics eligibility.",
    priority: "Critical",
  },
  {
    area: "Israeli Lotto rules assumptions",
    problem:
      "Timezone and calendar treatment is not formalized for draw cutoff and publication timestamps.",
    why:
      "Date-window analytics can shift by one day around timezone/daylight changes and cause disputes.",
    fix:
      "Standardize ingest in UTC with stored source timezone metadata; compute user-facing windows in Israel local time with tested DST logic.",
    priority: "High",
  },
  {
    area: "Analytics engine weaknesses",
    problem:
      "No statistical significance policy is defined for hot/cold and trend outputs.",
    why:
      "Users may over-interpret random fluctuations as meaningful without confidence and baseline framing.",
    fix:
      "Require confidence intervals, p-value/fdr policy where applicable, minimum sample windows, and small-sample suppression rules.",
    priority: "High",
  },
  {
    area: "Analytics engine weaknesses",
    problem:
      "No data quality score is attached to each insight or aggregate.",
    why:
      "Consumers cannot distinguish high-confidence outputs from partially reconciled data periods.",
    fix:
      "Add `data_quality_score`, source coverage, and freshness metadata to every analytics response and export.",
    priority: "High",
  },
  {
    area: "Security gaps",
    problem:
      "MFA is optional in general and not mandatory for privileged/admin actions.",
    why:
      "Admin-path compromise is a top practical risk for data exfiltration and service disruption.",
    fix:
      "Mandate MFA for admin roles and sensitive operations; enforce step-up authentication for key management and policy changes.",
    priority: "Critical",
  },
  {
    area: "Security gaps",
    problem:
      "No explicit secrets rotation SLAs or break-glass process are defined.",
    why:
      "Incident response speed and compliance posture degrade without operationally enforceable secret hygiene.",
    fix:
      "Define rotation cadence by secret class, automated rotation where possible, and audited emergency access workflow.",
    priority: "High",
  },
  {
    area: "Security gaps",
    problem:
      "No abuse/threat controls for automated scraping and bot traffic are specified.",
    why:
      "Public analytics APIs can be exhausted or harvested, impacting costs and availability.",
    fix:
      "Introduce bot detection, adaptive rate limits, API key tiers, and anomaly-based throttling.",
    priority: "High",
  },
  {
    area: "Deployment risks",
    problem:
      "Cross-region replication is specified without data residency/legal constraints and cost envelope.",
    why:
      "May violate jurisdictional requirements or create unsustainable operating costs early.",
    fix:
      "Add deployment decision matrix: residency requirement, business continuity tier, and stage-gated regional expansion.",
    priority: "Medium",
  },
  {
    area: "Deployment risks",
    problem:
      "No explicit release freeze, rollback validation, and migration safety protocol is defined.",
    why:
      "Schema/pipeline changes can cause production data corruption if deploy controls are weak.",
    fix:
      "Require backward-compatible migrations, preflight checks, canary promotion gates, and tested rollback playbooks per release.",
    priority: "High",
  },
  {
    area: "Scalability issues",
    problem:
      "Throughput targets are static and not tied to growth triggers or capacity planning model.",
    why:
      "System can under- or over-provision due to lack of demand-driven scaling policies.",
    fix:
      "Define capacity model with quarterly forecast inputs, autoscaling thresholds, and cost/performance guardrails.",
    priority: "Medium",
  },
  {
    area: "Scalability issues",
    problem:
      "Heavy ad hoc analytics queries are not isolated from transactional workloads.",
    why:
      "Expensive queries can degrade core API performance and violate latency SLOs.",
    fix:
      "Introduce workload isolation: read replicas/materialized aggregates/query quotas and asynchronous job execution for heavy analysis.",
    priority: "High",
  },
  {
    area: "MVP scope problems",
    problem:
      "Current roadmap places ingestion hardening, analytics foundation, AI insights, and enterprise controls too close together.",
    why:
      "Scope concentration increases delivery slippage risk and reduces quality of core data reliability.",
    fix:
      "Re-sequence MVP: first trusted data platform + deterministic analytics; defer AI generation and advanced personalization.",
    priority: "Critical",
  },
  {
    area: "MVP scope problems",
    problem:
      "Phase 1 exit criteria focus on ingestion uptime only; missing product and data-consumer acceptance criteria.",
    why:
      "A technically live platform may still fail user value and analytical correctness expectations.",
    fix:
      "Add acceptance KPIs: analyst task completion rate, reconciliation error rate, API correctness tests, and dashboard usability targets.",
    priority: "High",
  },
];

const correctedMvpScope = [
  {
    stream: "In scope",
    details:
      "Canonical historical draw ingestion for one primary Israeli Lotto game variant with rule-versioned schema and legal-approved source.",
    success:
      ">= 99.9% reconciled historical completeness for chosen variant; duplicate/correction handling fully operational.",
  },
  {
    stream: "In scope",
    details:
      "Deterministic statistics v1: frequency, recency, gap, parity, co-occurrence for fixed windows with confidence framing.",
    success:
      "All metrics reproducible across reruns; statistical output includes confidence metadata and educational disclaimer.",
  },
  {
    stream: "In scope",
    details:
      "Read-only APIs + web UI for draw explorer, filters, saved views, and CSV export (no PDF in Phase 1).",
    success:
      "P95 <= 500 ms for cached reads; analyst UAT pass rate >= 85% for key workflows.",
  },
  {
    stream: "In scope",
    details:
      "Production baseline security: OIDC, RBAC, mandatory MFA for admin roles, audit logging, secret rotation policy.",
    success:
      "Zero critical vulnerabilities at release; audited admin events and access controls verified.",
  },
  {
    stream: "In scope",
    details:
      "Operational baseline: CI/CD with migration safety gates, observability dashboards, incident runbooks, backup/restore drills.",
    success:
      "Recovery drill meets RPO <= 15m and RTO <= 60m in staging simulation.",
  },
  {
    stream: "Out of scope (defer)",
    details:
      "Generative AI insight text generation and moderation workflow.",
    success:
      "Deferred to Phase 2 after analytics quality and governance baselines are stable.",
  },
  {
    stream: "Out of scope (defer)",
    details:
      "Multi-game variant expansion, advanced alerting channels, PDF reporting, and cross-region active-active topology.",
    success:
      "Prioritized after measured adoption and capacity thresholds are reached.",
  },
];

const phase1Plan = [
  {
    milestone: "M1 (Weeks 1-3)",
    focus: "Legal/data contracts + canonical schema + rule catalog",
    gate: "Source license sign-off and validated historical backfill sample",
  },
  {
    milestone: "M2 (Weeks 4-6)",
    focus: "Ingestion pipeline + semantic validation + reconciliation dashboard",
    gate: "Duplicate/correction tests pass and completeness >= 99.5% in dry runs",
  },
  {
    milestone: "M3 (Weeks 7-9)",
    focus: "Deterministic analytics v1 + materialized aggregates + API contracts",
    gate: "Metric reproducibility and API contract tests pass in staging",
  },
  {
    milestone: "M4 (Weeks 10-12)",
    focus: "Frontend explorer + security hardening + operational readiness",
    gate: "UAT approved, performance gates met, release readiness review complete",
  },
];

export default function LottoSrsGapAnalysis() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Intelligence Israel - SRS Gap Analysis</H1>
        <H2>Final Consolidated Recommendations</H2>
        <Text style={{ color: theme.text.secondary }}>
          Review lens: Senior Software Architect + Senior Data Engineer + Senior Product Manager
        </Text>
        <Stack horizontal gap={8}>
          <Pill tone="warning">Action Required</Pill>
          <Pill tone="danger">Production Risk</Pill>
          <Pill tone="info">MVP Re-scoped</Pill>
        </Stack>
      </Stack>

      <Divider />

      <Card>
        <CardHeader
          title="Priority-Ordered Gap Analysis"
          subtitle="Each issue includes Problem, Why it matters, Recommended fix, and Priority"
        />
        <CardBody>
          <Table
            columns={[
              { key: "area", title: "Area", align: "left" },
              { key: "problem", title: "Problem", align: "left" },
              { key: "why", title: "Why it matters", align: "left" },
              { key: "fix", title: "Recommended fix", align: "left" },
              { key: "priority", title: "Priority", align: "left" },
            ]}
            rows={recommendations}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Corrected Phase 1 MVP Scope (Ready for Development)"
          subtitle="Realistic scope for 12-week enterprise-ready Phase 1"
        />
        <CardBody>
          <Table
            columns={[
              { key: "stream", title: "Scope", align: "left" },
              { key: "details", title: "Definition", align: "left" },
              { key: "success", title: "Success Criteria", align: "left" },
            ]}
            rows={correctedMvpScope}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Corrected Phase 1 Delivery Plan"
          subtitle="Execution sequence and governance gates"
        />
        <CardBody>
          <Table
            columns={[
              { key: "milestone", title: "Milestone", align: "left" },
              { key: "focus", title: "Primary Focus", align: "left" },
              { key: "gate", title: "Exit Gate", align: "left" },
            ]}
            rows={phase1Plan}
          />
        </CardBody>
      </Card>

      <Text style={{ color: theme.text.secondary }}>
        Recommended immediate action: approve the corrected MVP scope, then revise the SRS baseline
        and architecture decision records before implementation starts.
      </Text>
    </Stack>
  );
}
