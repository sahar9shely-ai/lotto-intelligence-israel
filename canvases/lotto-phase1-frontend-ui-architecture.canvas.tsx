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

const techStackRows: Row[] = [
  {
    layer: "Framework",
    selection: "React 18 + TypeScript 5 (strict mode)",
    rationale: "Typed component contracts and predictable long-term maintainability.",
  },
  {
    layer: "Build tooling",
    selection: "Vite + pnpm + ESLint + Prettier",
    rationale: "Fast iteration, deterministic builds, and enforced code quality.",
  },
  {
    layer: "UI foundation",
    selection: "Design token driven component library (internal), CSS variables, logical properties",
    rationale: "Consistent RTL-ready theming and scalable design governance.",
  },
  {
    layer: "State/data",
    selection: "TanStack Query (server state) + lightweight Zustand/Context for UI state",
    rationale: "Strong caching, retry control, stale policies, and minimal global-state complexity.",
  },
  {
    layer: "Charts",
    selection: "Composable SVG chart layer with RTL-aware axes and locale formatters",
    rationale: "Precise control over Hebrew labels and accessibility semantics.",
  },
  {
    layer: "Testing",
    selection: "Vitest + React Testing Library + Playwright",
    rationale: "Fast unit/integration tests and robust end-to-end regression coverage.",
  },
  {
    layer: "Observability",
    selection: "Frontend telemetry (web vitals, API timings, error events) with request correlation IDs",
    rationale: "Production diagnostics linked end-to-end with backend logs.",
  },
];

const projectStructureRows: Row[] = [
  { path: "src/app/", purpose: "Application shell, routing, providers, RTL/i18n bootstrap." },
  { path: "src/pages/", purpose: "Top-level Phase 1 screens and route-level composition." },
  { path: "src/features/draws/", purpose: "Draw listing and draw detail presentation logic." },
  { path: "src/features/stats-frequency/", purpose: "Frequency analytics module (queries, mappers, views)." },
  { path: "src/features/stats-strong/", purpose: "Strong-number analytics module." },
  { path: "src/features/stats-pairs/", purpose: "Pair analysis module." },
  { path: "src/features/imports/", purpose: "Import trigger flows and import status visibility widgets." },
  { path: "src/features/system-health/", purpose: "System health and dependency status visualization." },
  { path: "src/components/", purpose: "Reusable UI primitives and dashboard widgets." },
  { path: "src/design-system/", purpose: "Tokens, typography scale, spacing, color semantics, component specs." },
  { path: "src/services/api/", purpose: "Typed API clients, schema guards, error mapping, retry policies." },
  { path: "src/state/", purpose: "Cross-page UI state (filters, panel state, persisted preferences)." },
  { path: "src/utils/", purpose: "Formatters (Hebrew date/number), chart helpers, accessibility helpers." },
  { path: "src/tests/", purpose: "Shared test fixtures, mocks, accessibility/performance test utilities." },
];

const rtlRows: Row[] = [
  {
    area: "Document direction",
    decision: "Global `dir=rtl` at app root; per-component override only when needed for numerics.",
    implementation: "Use CSS logical properties (`margin-inline-start`, `padding-inline-end`, etc.).",
  },
  {
    area: "Typography and language",
    decision: "Hebrew as default locale; date/time and number formatting in Hebrew-Israel conventions.",
    implementation: "Locale-aware formatters for ILS currency, dates, and percent precision.",
  },
  {
    area: "Data presentation",
    decision: "Tables/charts visually RTL while preserving numeric scanability.",
    implementation: "Numeric cells left-aligned for readability; Hebrew labels and legends right-aligned.",
  },
  {
    area: "Navigation pattern",
    decision: "Primary navigation starts right side; breadcrumbs and pagination mirror RTL flow.",
    implementation: "Icon direction, keyboard order, and focus management aligned to RTL semantics.",
  },
];

const designSystemRows: Row[] = [
  {
    category: "Visual language",
    definition: "Modern, flat, professional dashboard style; no decorative gradients/shadows.",
    controls: "Neutral surfaces, high-contrast text, restrained accent palette for emphasis.",
  },
  {
    category: "Token system",
    definition: "Semantic tokens: surface, text, success, warning, danger, info, border, focus.",
    controls: "Single source tokens used by all components and charts.",
  },
  {
    category: "Component set",
    definition: "Cards, data table, filter bar, stat tile, chart container, callout, skeleton, empty-state block.",
    controls: "Strict variants and spacing scale to avoid ad hoc UI drift.",
  },
  {
    category: "Content policy UI",
    definition: "Mandatory educational disclaimer zone on all statistics screens.",
    controls: "No prediction or recommendation call-to-actions anywhere in Phase 1.",
  },
];

const pageStructureRows: Row[] = [
  {
    page: "Global App Shell",
    structure: "Top bar (timestamp/source freshness) + right-side navigation + content canvas + global notifications.",
    purpose: "Consistent navigation and operational context on every screen.",
  },
  {
    page: "Screen template",
    structure: "Header + filter/action row + primary analytics/table panel + secondary context panel.",
    purpose: "Predictable information hierarchy for analysts.",
  },
];

const componentArchitectureRows: Row[] = [
  {
    layer: "Primitives",
    examples: "Button, Input, Select, Table, Badge, Card, Alert, Skeleton.",
    rule: "No business logic; fully token-driven and accessible by default.",
  },
  {
    layer: "Composites",
    examples: "FilterToolbar, SnapshotBadge, ErrorBanner, DataQualityChip, EmptyStatePanel.",
    rule: "Reusable domain-aware UI blocks with standardized props.",
  },
  {
    layer: "Screen containers",
    examples: "DashboardContainer, DrawsContainer, FrequencyContainer.",
    rule: "Own data orchestration, query parameter mapping, and state transitions.",
  },
];

const stateManagementRows: Row[] = [
  {
    stateType: "Server state",
    approach: "TanStack Query per endpoint with typed query keys and stale-time tuning.",
    notes: "Cache keys include snapshot_id-affecting parameters to prevent mixed analytics states.",
  },
  {
    stateType: "URL state",
    approach: "Filters/sort/pagination persisted in URL query parameters.",
    notes: "Shareable deep links and deterministic back/forward behavior.",
  },
  {
    stateType: "Local UI state",
    approach: "Lightweight store for panel open/close, table column visibility, transient preferences.",
    notes: "No business data duplication outside server-state cache.",
  },
];

const apiIntegrationRows: Row[] = [
  {
    concern: "Client contract",
    strategy: "Typed API service layer aligned with backend OpenAPI contracts.",
    guardrail: "Runtime schema guards on responses for critical statistics payloads.",
  },
  {
    concern: "Request correlation",
    strategy: "Attach request id headers and propagate backend correlation ids to UI telemetry.",
    guardrail: "Displayed in debug panel for support investigations.",
  },
  {
    concern: "Retries/timeouts",
    strategy: "Conservative retry policy (idempotent GET retries only, bounded exponential backoff).",
    guardrail: "No automatic retries for import POST; explicit user retry action required.",
  },
  {
    concern: "Data consistency",
    strategy: "Stats views pinned to one snapshot response context per query set.",
    guardrail: "Show snapshot metadata badge and freshness marker in UI.",
  },
];

const errorLoadingRows: Row[] = [
  {
    scenario: "Initial screen load",
    loadingState: "Skeleton layout preserving final structure.",
    errorState: "Inline error panel with retry + technical request id.",
  },
  {
    scenario: "Filter/query change",
    loadingState: "Non-blocking shimmer over data region only.",
    errorState: "Keep previous successful data with stale marker and error banner.",
  },
  {
    scenario: "Import submit",
    loadingState: "Submit button busy state + progress toast.",
    errorState: "Field-level validation + global submission failure summary.",
  },
  {
    scenario: "No data",
    loadingState: "Not applicable.",
    errorState: "Contextual empty state with explanation of possible causes and clear next action.",
  },
];

const chartStrategyRows: Row[] = [
  {
    chartType: "Frequency bar chart",
    useCase: "Top/lowest number frequency comparison.",
    requirements: "RTL label rendering, value tooltips, source window caption, quality score badge.",
  },
  {
    chartType: "Strong-number distribution",
    useCase: "Strong number appearance rates.",
    requirements: "Small-category bar chart with confidence/freshness annotations.",
  },
  {
    chartType: "Pair support chart",
    useCase: "Top pair support and lift comparison.",
    requirements: "Pair labels normalized order, legend, explanatory note for support/lift meaning.",
  },
  {
    chartType: "Summary tiles + micro trends",
    useCase: "Dashboard high-level orientation.",
    requirements: "No predictive framing, only historical descriptive analytics.",
  },
];

const accessibilityRows: Row[] = [
  {
    area: "Standards",
    requirement: "WCAG 2.1 AA minimum across all Phase 1 screens.",
    enforcement: "Automated axe checks + manual keyboard/screen-reader QA gates.",
  },
  {
    area: "Keyboard",
    requirement: "Full keyboard navigation including filter controls, tables, and chart alternatives.",
    enforcement: "Visible focus states and logical RTL tab order.",
  },
  {
    area: "Screen reader",
    requirement: "Meaningful Hebrew labels, ARIA landmarks, and chart text alternatives.",
    enforcement: "Every chart has accessible summary and data table fallback.",
  },
  {
    area: "Color/contrast",
    requirement: "Contrast ratio meeting AA; color never sole carrier of meaning.",
    enforcement: "Token-level contrast testing and semantic icon/text redundancy.",
  },
];

const performanceRows: Row[] = [
  {
    target: "Initial load",
    requirement: "LCP <= 2.5s on standard enterprise network profile.",
    method: "Route-level code splitting, critical CSS, compressed assets.",
  },
  {
    target: "Interaction latency",
    requirement: "Filter/sort interactions update visible data in <= 300ms when cached.",
    method: "Query caching + memoized table/chart rendering.",
  },
  {
    target: "Large table usability",
    requirement: "Draws table handles 10k+ logical rows through pagination without frame drops.",
    method: "Server pagination + lightweight row rendering + deferred non-critical UI updates.",
  },
  {
    target: "Runtime stability",
    requirement: "No memory growth across prolonged analyst session.",
    method: "Cache garbage collection policy and bounded client-state retention.",
  },
];

const testingRows: Row[] = [
  {
    testType: "Unit tests",
    scope: "Formatting, validation helpers, query param mappers, reusable UI components.",
    gate: "Mandatory in CI.",
  },
  {
    testType: "Integration tests",
    scope: "Screen containers with mocked API contracts and state transitions.",
    gate: "Mandatory in CI.",
  },
  {
    testType: "E2E tests",
    scope: "Critical user flows across all required screens in Hebrew RTL.",
    gate: "Mandatory pre-release.",
  },
  {
    testType: "Accessibility tests",
    scope: "Automated + manual checks per screen and component library.",
    gate: "Mandatory pre-release.",
  },
  {
    testType: "Performance tests",
    scope: "Web vitals and interaction timing under representative datasets.",
    gate: "Mandatory pre-release.",
  },
];

const screenRows: Row[] = [
  {
    screen: "Dashboard",
    purpose: "Executive snapshot of historical activity and data quality context.",
    uiLayout:
      "Header KPIs + summary cards + mini charts + freshness/disclaimer strip.",
    mainComponents:
      "SummaryTiles, SnapshotBadge, FrequencyMiniChart, PairMiniChart, DataQualityBanner.",
    apiEndpoints: "GET /api/v1/stats/summary",
    emptyStates:
      "No published snapshot yet: show onboarding callout and import guidance.",
    loadingStates: "Skeleton cards and chart placeholders preserving final layout.",
    errorStates: "Top error banner with retry and request id.",
    validationRules:
      "Require valid game/window filters before query; reject unsupported rule variants.",
    performanceNotes:
      "Single summary call; target screen data paint <= 900ms cached.",
  },
  {
    screen: "Draws Table",
    purpose: "Browse and inspect historical draws with precise filtering.",
    uiLayout:
      "Filter toolbar + paginated table + detail side panel for selected draw.",
    mainComponents:
      "DrawsFilterBar, DrawsDataTable, PaginationControl, DrawDetailPanel.",
    apiEndpoints: "GET /api/v1/draws, GET /api/v1/draws/{draw_id}",
    emptyStates:
      "No draws for selected filter window: show date/rule guidance and reset action.",
    loadingStates: "Table skeleton rows + non-blocking panel spinner.",
    errorStates: "Inline table error row + preserved last successful dataset.",
    validationRules:
      "from_date <= to_date, allowed sort fields only, cursor integrity required.",
    performanceNotes:
      "Server cursor pagination, avoid client-side full-list accumulation.",
  },
  {
    screen: "Number Frequency",
    purpose: "Analyze regular number frequency, recency, and quality metrics.",
    uiLayout:
      "Filter row + ranked chart + supporting data table + educational context box.",
    mainComponents:
      "FrequencyFilterBar, FrequencyBarChart, FrequencyMetricsTable, DisclaimerPanel.",
    apiEndpoints: "GET /api/v1/stats/frequency",
    emptyStates:
      "No snapshot/window data: show explanation and suggest broader window.",
    loadingStates: "Chart skeleton + table shimmer.",
    errorStates: "Chart fallback panel with retry and diagnostics id.",
    validationRules:
      "top_n bounds, valid date window, supported game/rule combination only.",
    performanceNotes:
      "Pin to one snapshot_id and memoize chart transformations.",
  },
  {
    screen: "Strong Number Statistics",
    purpose: "Present strong-number historical distribution for eligible variants.",
    uiLayout:
      "Variant-aware filter bar + strong-number chart + ranked table.",
    mainComponents:
      "StrongNumberFilterBar, StrongDistributionChart, StrongRankingTable.",
    apiEndpoints: "GET /api/v1/stats/strong-number",
    emptyStates:
      "Variant does not support strong number or no data in window: contextual message.",
    loadingStates: "Lightweight chart/table skeletons.",
    errorStates: "Variant validation error banner or endpoint failure panel.",
    validationRules:
      "Only allow variants supporting strong number; enforce valid top_n and window.",
    performanceNotes:
      "Keep chart bins bounded; avoid expensive client aggregation.",
  },
  {
    screen: "Pair Analysis",
    purpose: "Explore top historical pair co-occurrence and support metrics.",
    uiLayout:
      "Filter controls + ranked pair chart + sortable pair table + methodology note.",
    mainComponents:
      "PairFilterBar, PairSupportChart, PairTable, StatsMethodologyCallout.",
    apiEndpoints: "GET /api/v1/stats/pairs",
    emptyStates:
      "No qualifying pairs for filters/min_support: suggest reducing threshold.",
    loadingStates: "Chart/table segmented loading state.",
    errorStates: "Inline error card while preserving prior results if available.",
    validationRules:
      "min_support_pct 0..100, top_n limits, canonical pair labeling.",
    performanceNotes:
      "Request bounded top_n; render virtualized table for larger result sets.",
  },
  {
    screen: "Import Data Screen",
    purpose: "Operational trigger screen for approved draw source imports.",
    uiLayout:
      "Import form card + safety checklist + recent import status feed.",
    mainComponents:
      "ImportForm, SourceValidationNotice, ImportSubmitPanel, RecentImportLogTable.",
    apiEndpoints: "POST /api/v1/import/draws",
    emptyStates:
      "No prior imports: show first-import instructions and compliance reminder.",
    loadingStates: "Submit in-progress state + optimistic queue acceptance toast.",
    errorStates: "Field-level validation, duplicate request warning, queue unavailable error.",
    validationRules:
      "Approved source only, idempotency key required, backfill date limits enforced.",
    performanceNotes:
      "Non-blocking UX; submit response target <= 200ms before background processing.",
  },
  {
    screen: "System Health Screen",
    purpose: "Provide operational visibility of API and dependency status.",
    uiLayout:
      "System status header + dependency cards + latency/error indicators + last-check timestamp.",
    mainComponents:
      "HealthStatusBadge, DependencyStatusGrid, HealthMetricsPanel, IncidentHintBanner.",
    apiEndpoints: "GET /health",
    emptyStates:
      "Not applicable; always show latest known health result and refresh controls.",
    loadingStates: "Compact polling indicator with stale timestamp display.",
    errorStates: "Health fetch failure panel with manual refresh and fallback status.",
    validationRules:
      "Accept only documented health scopes and status enums.",
    performanceNotes:
      "Low-cost polling cadence (e.g., 15-30s) with backoff on repeated failures.",
  },
];

export default function LottoPhase1FrontendArchitecture() {
  const theme = useHostTheme();

  return (
    <Stack gap={18} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={6}>
        <H1>Lotto Intelligence Israel - Phase 1 Frontend/UI Architecture</H1>
        <H2>Final Production-Grade Design (Single Professional Approach)</H2>
        <Text style={{ color: theme.text.secondary }}>
          Scope: Hebrew RTL, modern analytical dashboard UX, educational statistics only, no prediction/recommendation UI, no login screen in Phase 1.
        </Text>
        <Stack horizontal gap={8}>
          <Pill tone="info">Phase 1 MVP</Pill>
          <Pill tone="warning">Hebrew RTL First</Pill>
          <Pill tone="danger">No Gambling Recommendation UI</Pill>
        </Stack>
      </Stack>

      <Divider />

      <Card>
        <CardHeader title="1) Frontend Technology Stack" subtitle="Selected production stack for Phase 1" />
        <CardBody>
          <Table
            columns={[
              { key: "layer", title: "Layer", align: "left" },
              { key: "selection", title: "Selection", align: "left" },
              { key: "rationale", title: "Rationale", align: "left" },
            ]}
            rows={techStackRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2) React + TypeScript Project Structure" subtitle="Feature-oriented modular architecture" />
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
        <CardHeader title="3) RTL Hebrew Layout Strategy" subtitle="Native right-to-left interaction design" />
        <CardBody>
          <Table
            columns={[
              { key: "area", title: "Area", align: "left" },
              { key: "decision", title: "Decision", align: "left" },
              { key: "implementation", title: "Implementation", align: "left" },
            ]}
            rows={rtlRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="4) Design System" subtitle="Consistent, modern, professional UI language" />
        <CardBody>
          <Table
            columns={[
              { key: "category", title: "Category", align: "left" },
              { key: "definition", title: "Definition", align: "left" },
              { key: "controls", title: "Controls", align: "left" },
            ]}
            rows={designSystemRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="5) Page Structure" subtitle="Global shell and screen composition model" />
        <CardBody>
          <Table
            columns={[
              { key: "page", title: "Page Area", align: "left" },
              { key: "structure", title: "Structure", align: "left" },
              { key: "purpose", title: "Purpose", align: "left" },
            ]}
            rows={pageStructureRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="6) Component Architecture" subtitle="Layered component model" />
        <CardBody>
          <Table
            columns={[
              { key: "layer", title: "Layer", align: "left" },
              { key: "examples", title: "Examples", align: "left" },
              { key: "rule", title: "Architecture Rule", align: "left" },
            ]}
            rows={componentArchitectureRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="7) State Management Strategy" subtitle="Deterministic and URL-driven analytics state" />
        <CardBody>
          <Table
            columns={[
              { key: "stateType", title: "State Type", align: "left" },
              { key: "approach", title: "Approach", align: "left" },
              { key: "notes", title: "Notes", align: "left" },
            ]}
            rows={stateManagementRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="8) API Integration Strategy" subtitle="Typed client contracts and consistency guards" />
        <CardBody>
          <Table
            columns={[
              { key: "concern", title: "Concern", align: "left" },
              { key: "strategy", title: "Strategy", align: "left" },
              { key: "guardrail", title: "Guardrail", align: "left" },
            ]}
            rows={apiIntegrationRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="9) Error and Loading States" subtitle="Consistent UX state transitions" />
        <CardBody>
          <Table
            columns={[
              { key: "scenario", title: "Scenario", align: "left" },
              { key: "loadingState", title: "Loading State", align: "left" },
              { key: "errorState", title: "Error State", align: "left" },
            ]}
            rows={errorLoadingRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="10) Chart and Visualization Strategy" subtitle="Accessible, explanatory analytical visuals" />
        <CardBody>
          <Table
            columns={[
              { key: "chartType", title: "Chart Type", align: "left" },
              { key: "useCase", title: "Use Case", align: "left" },
              { key: "requirements", title: "Requirements", align: "left" },
            ]}
            rows={chartStrategyRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="11) Accessibility Requirements" subtitle="WCAG AA and RTL usability commitments" />
        <CardBody>
          <Table
            columns={[
              { key: "area", title: "Area", align: "left" },
              { key: "requirement", title: "Requirement", align: "left" },
              { key: "enforcement", title: "Enforcement", align: "left" },
            ]}
            rows={accessibilityRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="12) Performance Requirements" subtitle="Phase 1 UX performance targets" />
        <CardBody>
          <Table
            columns={[
              { key: "target", title: "Target", align: "left" },
              { key: "requirement", title: "Requirement", align: "left" },
              { key: "method", title: "Method", align: "left" },
            ]}
            rows={performanceRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="13) Testing Strategy" subtitle="Quality gates for production release" />
        <CardBody>
          <Table
            columns={[
              { key: "testType", title: "Test Type", align: "left" },
              { key: "scope", title: "Scope", align: "left" },
              { key: "gate", title: "Gate", align: "left" },
            ]}
            rows={testingRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Required Phase 1 Screens - Detailed Contracts" subtitle="Purpose, UI, components, API, states, validation, performance" />
        <CardBody>
          <Table
            columns={[
              { key: "screen", title: "Screen", align: "left" },
              { key: "purpose", title: "Purpose", align: "left" },
              { key: "uiLayout", title: "UI Layout", align: "left" },
              { key: "mainComponents", title: "Main Components", align: "left" },
              { key: "apiEndpoints", title: "API Endpoints Used", align: "left" },
              { key: "emptyStates", title: "Empty States", align: "left" },
              { key: "loadingStates", title: "Loading States", align: "left" },
              { key: "errorStates", title: "Error States", align: "left" },
              { key: "validationRules", title: "Validation Rules", align: "left" },
              { key: "performanceNotes", title: "Performance Notes", align: "left" },
            ]}
            rows={screenRows}
          />
          <Stack gap={6}>
            <H3>Final Product Constraints</H3>
            <Text>
              All statistics screens must display an educational disclaimer and must never expose prediction, recommendation, or betting advice messaging. Phase 1 excludes login and user-account flows by design.
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
