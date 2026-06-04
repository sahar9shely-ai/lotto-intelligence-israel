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
    check: "1) Screen completeness",
    problem:
      "Import Data Screen expects 'recent import status feed' but approved Phase 1 API set provides only import trigger endpoint with no status endpoint.",
    risk:
      "Screen cannot reliably render real-time import status, causing broken operational workflow.",
    correction:
      "Constrain Phase 1 Import screen to trigger + accepted job receipt + guidance on asynchronous completion via operational logs; remove dependency on live status list until a status endpoint exists in a later phase.",
    priority: "Critical",
  },
  {
    check: "1) Screen completeness",
    problem:
      "System Health screen assumes dependency cards/latency diagnostics beyond guaranteed `/health` contract fields.",
    risk:
      "UI can overpromise diagnostics and degrade trust when backend does not provide matching fields.",
    correction:
      "Bind System Health UI strictly to documented `/health` payload fields and mark additional diagnostics as non-Phase 1.",
    priority: "High",
  },
  {
    check: "2) Unnecessary screen/component scope",
    problem:
      "Draws Table includes `DrawDetailPanel` requiring expanded detail behavior not explicitly guaranteed in Phase 1 UX objectives.",
    risk:
      "Adds complexity and interaction overhead without core MVP value.",
    correction:
      "Keep draw detail as lightweight modal/panel only for essential fields; avoid complex nested interactions in Phase 1.",
    priority: "Medium",
  },
  {
    check: "3) RTL Hebrew UX risks",
    problem:
      "RTL strategy lacks explicit bidi handling for mixed Hebrew/Latin strings (IDs, API keys, timestamps, pair labels).",
    risk:
      "Misordered text and unreadable operational values in production.",
    correction:
      "Apply explicit bidi isolation (`bdi`/unicode-bidi isolate) for mixed-direction tokens and technical identifiers.",
    priority: "High",
  },
  {
    check: "3) RTL Hebrew UX risks",
    problem:
      "Numeric alignment guidance is present, but no rule for mirrored chart interaction patterns (tooltip anchors, axis progression, keyboard nav in charts).",
    risk:
      "Inconsistent and confusing chart interactions for Hebrew RTL users.",
    correction:
      "Define RTL chart interaction contract: mirrored horizontal navigation, tooltip placement constraints, and keyboard semantics.",
    priority: "Medium",
  },
  {
    check: "4) Component architecture risks",
    problem:
      "No explicit boundary preventing feature components from directly calling API layer.",
    risk:
      "Architectural drift and duplicated query logic across screens.",
    correction:
      "Enforce container/service boundary: only screen containers call feature query hooks; presentational components remain data-agnostic.",
    priority: "Medium",
  },
  {
    check: "5) State management risks",
    problem:
      "URL state is defined, but no canonical filter-state schema/versioning strategy is provided.",
    risk:
      "Breaking deep links after iterative releases and inconsistent shared URLs.",
    correction:
      "Introduce versioned URL query schema with migration logic for backwards compatibility.",
    priority: "Medium",
  },
  {
    check: "5) State management risks",
    problem:
      "No explicit stale-data conflict rule when cached stats mismatch newly selected filters during rapid interactions.",
    risk:
      "Users may interpret stale analytics as current.",
    correction:
      "Require visible 'updating' and 'snapshot mismatch' states until filter-confirmed data returns for current query key.",
    priority: "High",
  },
  {
    check: "6) API integration gaps",
    problem:
      "Frontend contract still implies `draw_id` identity but API production review requires immutable `draw_uid` semantics with `draw_revision_id` lineage.",
    risk:
      "Incorrect routing/caching and broken draw detail references after corrections.",
    correction:
      "Update frontend routing and entity model: route key uses immutable draw uid; show revision id as metadata only.",
    priority: "Critical",
  },
  {
    check: "6) API integration gaps",
    problem:
      "Frontend validation rules do not mention API-required idempotency key for import requests.",
    risk:
      "Duplicate import submissions and avoidable backend conflicts.",
    correction:
      "Generate and send client idempotency key per import submission; block duplicate clicks while key is active.",
    priority: "High",
  },
  {
    check: "7) Chart performance risks",
    problem:
      "Chart strategy lacks explicit dataset size caps and progressive rendering rules.",
    risk:
      "Performance degradation on low-end devices and mobile browsers.",
    correction:
      "Define hard limits per visualization (`top_n` bounds mirrored in UI) and pre-aggregation-only rendering for Phase 1.",
    priority: "High",
  },
  {
    check: "7) Chart performance risks",
    problem:
      "No explicit off-main-thread strategy for expensive chart data transforms.",
    risk:
      "UI jank during filter changes and interaction latency regressions.",
    correction:
      "Use memoized selectors and optional web worker path for heavy client-side transformations if threshold exceeded.",
    priority: "Medium",
  },
  {
    check: "8) Empty/loading/error gaps",
    problem:
      "Empty state policy does not distinguish between 'no data for filter' vs 'data unavailable due to unpublished snapshot'.",
    risk:
      "User confusion and incorrect troubleshooting actions.",
    correction:
      "Introduce explicit empty-state taxonomy with different messages/actions for no-data, unpublished snapshot, and dependency failure.",
    priority: "High",
  },
  {
    check: "8) Empty/loading/error gaps",
    problem:
      "Error strategy lacks explicit handling for domain errors from approved API review (`RULE_CONFLICT`, `SNAPSHOT_NOT_PUBLISHED`).",
    risk:
      "Generic errors reduce trust and hinder user correction behavior.",
    correction:
      "Map domain error codes to targeted Hebrew guidance and corrective actions in each screen.",
    priority: "High",
  },
  {
    check: "9) Accessibility gaps",
    problem:
      "Accessibility section omits requirement for reduced-motion support and user preference honoring.",
    risk:
      "Motion-heavy transitions may fail accessibility expectations for sensitive users.",
    correction:
      "Respect `prefers-reduced-motion` across chart and loading animations; provide non-animated fallback.",
    priority: "Medium",
  },
  {
    check: "9) Accessibility gaps",
    problem:
      "No explicit requirement for table keyboard shortcuts and row-action accessibility in RTL context.",
    risk:
      "Power-user workflows become inefficient and less accessible.",
    correction:
      "Define keyboard interaction model for table navigation, row expansion, and action triggers with screen-reader announcements.",
    priority: "Medium",
  },
  {
    check: "10) Mobile responsiveness gaps",
    problem:
      "Architecture does not define responsive breakpoints, small-screen table behavior, or chart fallback layouts.",
    risk:
      "Phase 1 UI may be unusable on common tablet/mobile resolutions.",
    correction:
      "Define responsive contract: breakpoint system, cardified table fallback, horizontal scroll policy, and compact chart variants.",
    priority: "Critical",
  },
  {
    check: "10) Mobile responsiveness gaps",
    problem:
      "No explicit touch-target and spacing minima for RTL mobile interactions.",
    risk:
      "High interaction error rate on touch devices.",
    correction:
      "Set minimum touch target (44px), spacing rules, and mobile-specific filter drawer behavior.",
    priority: "High",
  },
  {
    check: "11) Testing coverage gaps",
    problem:
      "Testing plan omits visual regression testing for RTL layout and responsive breakpoints.",
    risk:
      "Unnoticed UI regressions in production across device sizes and locales.",
    correction:
      "Add visual regression snapshots for all required screens in desktop and mobile RTL modes.",
    priority: "High",
  },
  {
    check: "11) Testing coverage gaps",
    problem:
      "No explicit contract-mock tests for API error code mapping and idempotency flows.",
    risk:
      "Frontend behavior diverges from backend contract during edge cases.",
    correction:
      "Add integration tests covering domain error mappings, import idempotency, and snapshot-metadata rendering.",
    priority: "High",
  },
  {
    check: "12) API consistency",
    problem:
      "Frontend screen contracts do not explicitly require display of API-mandated reproducibility metadata (`snapshot_id`, `algorithm_version`, `engine_build_id`, `dataset_hash`, `data_quality_score`).",
    risk:
      "Loss of audit transparency and inconsistency with approved API production review.",
    correction:
      "Add mandatory metadata panel on all statistics screens showing snapshot and quality lineage fields.",
    priority: "Critical",
  },
  {
    check: "12) API consistency",
    problem:
      "System Health validation mentions health scopes, but frontend architecture does not align with final API decision to standardize optional scope contract consistently.",
    risk:
      "Mismatched query behavior and avoidable 400 errors.",
    correction:
      "Align health screen query strategy to finalized API contract and handle unsupported scope defensively.",
    priority: "Medium",
  },
];

const finalRecommendation: Row[] = [
  {
    component: "Scope and screens",
    recommendation:
      "Keep the seven required Phase 1 screens exactly as defined, but constrain Import and Health screens strictly to guaranteed API behaviors (no implicit status feed or undocumented diagnostics).",
    impact: "Preserves MVP scope while eliminating non-implementable UI assumptions.",
  },
  {
    component: "API-consistent data contract",
    recommendation:
      "Adopt immutable draw uid routing, include revision metadata as secondary context, and render mandatory statistics lineage/quality metadata on every analytics screen.",
    impact: "Ensures consistency with approved backend/data architecture and auditability goals.",
  },
  {
    component: "RTL and responsive UX",
    recommendation:
      "Implement RTL-first with bidi isolation for mixed tokens plus explicit mobile breakpoints, cardified table fallback, and touch-target standards.",
    impact: "Delivers production-grade Hebrew usability across desktop and mobile.",
  },
  {
    component: "State and interaction reliability",
    recommendation:
      "Use versioned URL state schema, signed cursor-aware pagination handling, and explicit stale-versus-fresh indicators tied to current query keys.",
    impact: "Prevents navigation drift and stale-data confusion in analytical workflows.",
  },
  {
    component: "Error/loading semantics",
    recommendation:
      "Implement domain-specific empty/loading/error taxonomy mapped to backend error codes and snapshot publication states.",
    impact: "Improves user trust, recoverability, and operational clarity.",
  },
  {
    component: "Performance and charting",
    recommendation:
      "Enforce chart dataset caps, memoized transforms, and progressive rendering with optional worker offload thresholds.",
    impact: "Maintains responsive interactions under realistic data volumes.",
  },
  {
    component: "Testing gates",
    recommendation:
      "Add RTL visual regression, responsive breakpoint test matrix, API error-mapping tests, and idempotency flow tests alongside existing unit/integration/E2E gates.",
    impact: "Closes key production-risk gaps before release.",
  },
];

export default function LottoPhase1FrontendProductionReview() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Phase 1 Frontend/UI - Production Readiness Review</H1>
        <H2>Principal Frontend Reviewer + Senior UX Audit + React Performance Review</H2>
        <Text style={{ color: theme.text.secondary }}>
          Strict review against approved SRS, gap analysis, data layer documents, and API architecture artifacts.
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
          title="Final Corrected Phase 1 Frontend/UI Recommendation"
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
              Approve Phase 1 frontend development only after all Critical and High corrections above are incorporated. This keeps the required screen scope intact, preserves the no-login and no-prediction policy, and aligns UI behavior with approved API and data contracts.
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
