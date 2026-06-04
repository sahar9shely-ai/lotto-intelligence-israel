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

type ReqRow = {
  id: string;
  requirement: string;
  priority: string;
  verification: string;
};

const functionalRows: ReqRow[] = [
  {
    id: "FR-01",
    requirement:
      "Ingest and normalize official historical Israeli lottery draws from approved source feeds on a configurable schedule.",
    priority: "Must",
    verification: "Automated ingestion test + source reconciliation",
  },
  {
    id: "FR-02",
    requirement:
      "Validate raw draw records (date, game type, draw number, winning numbers, bonus number, jackpot metadata) and quarantine invalid entries.",
    priority: "Must",
    verification: "Schema validation + bad-record test set",
  },
  {
    id: "FR-03",
    requirement:
      "Store immutable historical draw records with audit trail and versioning for corrections from the source authority.",
    priority: "Must",
    verification: "Data integrity and audit log test",
  },
  {
    id: "FR-04",
    requirement:
      "Provide advanced filtering by date range, game type, number frequency windows, parity, sequences, and jackpot bands.",
    priority: "Must",
    verification: "UI/API filter test matrix",
  },
  {
    id: "FR-05",
    requirement:
      "Compute descriptive statistics including frequency, recency, hot/cold indicators, co-occurrence, gap distribution, and trend deltas.",
    priority: "Must",
    verification: "Analytics engine deterministic tests",
  },
  {
    id: "FR-06",
    requirement:
      "Generate educational probability explainers for each statistic and clearly label insights as non-predictive and non-advisory.",
    priority: "Must",
    verification: "Content policy tests + UI assertions",
  },
  {
    id: "FR-07",
    requirement:
      "Support authenticated user workspaces with saved views, watchlists, alert preferences, and comparison snapshots.",
    priority: "Should",
    verification: "End-to-end account and persistence tests",
  },
  {
    id: "FR-08",
    requirement:
      "Expose API endpoints for draw history, aggregate statistics, AI-generated insights, and export operations.",
    priority: "Must",
    verification: "OpenAPI contract + integration tests",
  },
  {
    id: "FR-09",
    requirement:
      "Enable exports (CSV/JSON/PDF report) with timestamp, dataset lineage, and applied filters metadata.",
    priority: "Should",
    verification: "Report generation and metadata tests",
  },
  {
    id: "FR-10",
    requirement:
      "Provide role-based admin console for data source configuration, ingestion health, policy rules, and model lifecycle status.",
    priority: "Must",
    verification: "RBAC and admin workflow tests",
  },
  {
    id: "FR-11",
    requirement:
      "Trigger explainable AI insights over selected historical windows using approved prompts/templates and confidence bands.",
    priority: "Should",
    verification: "Prompt template and output governance tests",
  },
  {
    id: "FR-12",
    requirement:
      "Emit observability events for user interactions, pipeline execution, API errors, and anomaly detections.",
    priority: "Must",
    verification: "Telemetry and dashboard validation tests",
  },
];

const nonFunctionalRows: ReqRow[] = [
  {
    id: "NFR-01",
    requirement:
      "API availability target is 99.9% monthly; ingestion pipeline availability target is 99.5% monthly.",
    priority: "Must",
    verification: "SLO dashboards and monthly review",
  },
  {
    id: "NFR-02",
    requirement:
      "P95 API latency below 350 ms for cached reads and below 900 ms for uncached analytical queries.",
    priority: "Must",
    verification: "Performance benchmark suite",
  },
  {
    id: "NFR-03",
    requirement:
      "Support 5,000 concurrent users and 150 requests/second baseline with horizontal scale-out.",
    priority: "Must",
    verification: "Load and soak testing",
  },
  {
    id: "NFR-04",
    requirement:
      "Encrypt all data in transit (TLS 1.3) and at rest (AES-256 managed keys).",
    priority: "Must",
    verification: "Security scan + config audit",
  },
  {
    id: "NFR-05",
    requirement:
      "RPO <= 15 minutes and RTO <= 60 minutes for production disaster recovery.",
    priority: "Must",
    verification: "Quarterly DR simulation",
  },
  {
    id: "NFR-06",
    requirement:
      "WCAG 2.1 AA accessibility compliance for user-facing web application.",
    priority: "Should",
    verification: "Automated + manual accessibility audit",
  },
  {
    id: "NFR-07",
    requirement:
      "Comply with Israeli privacy law and GDPR-equivalent controls for consent, retention, and user data requests.",
    priority: "Must",
    verification: "Legal/privacy control checklist",
  },
  {
    id: "NFR-08",
    requirement:
      "Zero critical and high unresolved vulnerabilities allowed in production releases.",
    priority: "Must",
    verification: "SAST/DAST/SCA release gates",
  },
  {
    id: "NFR-09",
    requirement:
      "Full traceability from requirement to test case, release artifact, and runtime monitor.",
    priority: "Should",
    verification: "Requirements traceability matrix",
  },
  {
    id: "NFR-10",
    requirement:
      "All insights must include educational disclaimer and explainability note before display.",
    priority: "Must",
    verification: "Policy engine tests + UI checks",
  },
];

const dbTables = [
  {
    table: "draws",
    purpose: "Immutable canonical draw facts",
    keyFields:
      "draw_id (PK), game_type, draw_date, draw_number, winning_numbers[], bonus_number, jackpot_amount, source_version",
    retention: "Permanent",
  },
  {
    table: "draw_ingestion_events",
    purpose: "Pipeline lineage and processing audit",
    keyFields:
      "event_id (PK), source_name, source_record_id, status, validation_errors, processed_at",
    retention: "7 years",
  },
  {
    table: "number_statistics_daily",
    purpose: "Materialized daily aggregates",
    keyFields:
      "stat_date, game_type, number, frequency_30d, recency_days, co_occurrence_score",
    retention: "Permanent",
  },
  {
    table: "ai_insights",
    purpose: "Governed generated insights",
    keyFields:
      "insight_id (PK), window_start, window_end, template_id, confidence_band, disclaimer_version, created_at",
    retention: "2 years",
  },
  {
    table: "users",
    purpose: "Identity and profile metadata",
    keyFields:
      "user_id (PK), email_hash, status, locale, created_at, last_login_at",
    retention: "Active + 2 years",
  },
  {
    table: "saved_views",
    purpose: "User-saved filters and dashboard presets",
    keyFields: "view_id (PK), user_id (FK), filter_blob, title, updated_at",
    retention: "Active lifetime",
  },
  {
    table: "alerts",
    purpose: "Notification and threshold subscriptions",
    keyFields:
      "alert_id (PK), user_id (FK), metric_name, threshold_rule, channel, is_active",
    retention: "Active lifetime",
  },
  {
    table: "access_audit_logs",
    purpose: "Security and compliance evidence",
    keyFields:
      "log_id (PK), actor_id, actor_role, action, resource, ip_hash, occurred_at",
    retention: "7 years",
  },
];

const apiEndpoints = [
  {
    endpoint: "GET /v1/draws",
    purpose: "Paginated draw history query",
    security: "OAuth2/JWT + rate limit",
  },
  {
    endpoint: "GET /v1/stats/frequency",
    purpose: "Number frequency aggregates by window",
    security: "OAuth2/JWT + response caching",
  },
  {
    endpoint: "GET /v1/stats/cooccurrence",
    purpose: "Pair and cluster co-occurrence scores",
    security: "OAuth2/JWT",
  },
  {
    endpoint: "POST /v1/insights/generate",
    purpose: "Generate governed AI educational insight",
    security: "OAuth2/JWT + policy validation",
  },
  {
    endpoint: "GET /v1/insights/{id}",
    purpose: "Fetch insight payload + explainability fields",
    security: "OAuth2/JWT + ownership checks",
  },
  {
    endpoint: "POST /v1/exports",
    purpose: "Create export job (CSV/JSON/PDF)",
    security: "OAuth2/JWT + async job quota",
  },
  {
    endpoint: "GET /v1/admin/ingestion/health",
    purpose: "Ingestion pipeline and source diagnostics",
    security: "Admin RBAC + MFA",
  },
];

const roadmap = [
  {
    phase: "Phase 0 - Inception (4 weeks)",
    deliverables:
      "Requirements baseline, legal review, source contracts, architecture decision records, risk register.",
    exitCriteria:
      "Approved SRS, signed compliance controls, prioritized backlog and release plan.",
  },
  {
    phase: "Phase 1 - Core Data Platform (8 weeks)",
    deliverables:
      "Ingestion pipelines, canonical schema, auditability, reconciliation dashboards, core APIs for draw retrieval.",
    exitCriteria:
      "Historical data completeness >= 99.95%, ingestion SLA met for 30 consecutive days.",
  },
  {
    phase: "Phase 2 - Analytics & UI Foundation (8 weeks)",
    deliverables:
      "Statistical engine v1, filtering/search, baseline frontend dashboards, export subsystem.",
    exitCriteria:
      "Performance and accessibility gates passed, UAT for analysts completed.",
  },
  {
    phase: "Phase 3 - AI Insights & Governance (6 weeks)",
    deliverables:
      "AI insight templates, explainability metadata, policy guardrails, human review workflow.",
    exitCriteria:
      "Policy pass rate >= 99%, AI output quality benchmark approved.",
  },
  {
    phase: "Phase 4 - Hardening & Production Launch (6 weeks)",
    deliverables:
      "Security hardening, SRE runbooks, DR drills, observability, incident response playbooks.",
    exitCriteria:
      "Go-live checklist complete, zero critical vulnerabilities, executive launch sign-off.",
  },
  {
    phase: "Phase 5 - Optimization (ongoing)",
    deliverables:
      "Model tuning, personalization, A/B tests, cost optimization, regional feature expansion.",
    exitCriteria:
      "Quarterly KPI targets met and reliability SLOs sustained.",
  },
];

export default function LottoIntelligenceIsraelSRS() {
  const theme = useHostTheme();

  return (
    <Stack gap={20} style={{ padding: 20, background: theme.canvas.background }}>
      <Stack gap={8}>
        <H1>Software Requirements Specification (SRS)</H1>
        <H2>Lotto Intelligence Israel</H2>
        <Text style={{ color: theme.text.secondary }}>
          Version: 1.0 | System Type: Educational and analytical lottery intelligence platform
          | Classification: Production-grade enterprise system
        </Text>
        <Text style={{ color: theme.text.secondary }}>
          Mission: Provide transparent, statistically rigorous analysis of historical Israeli
          lottery results for educational use only. The platform does not provide betting advice,
          guaranteed predictions, or financial recommendations.
        </Text>
        <Stack horizontal gap={8}>
          <Pill tone="info">Educational Use</Pill>
          <Pill tone="warning">Non-Advisory AI</Pill>
          <Pill tone="neutral">Enterprise SRS</Pill>
        </Stack>
      </Stack>

      <Divider />

      <Card>
        <CardHeader title="1. Functional Requirements" subtitle="Business and system capabilities" />
        <CardBody>
          <Table
            columns={[
              { key: "id", title: "ID", align: "left" },
              { key: "requirement", title: "Requirement", align: "left" },
              { key: "priority", title: "Priority", align: "left" },
              { key: "verification", title: "Verification", align: "left" },
            ]}
            rows={functionalRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="2. Non-Functional Requirements"
          subtitle="Quality attributes, constraints, and compliance requirements"
        />
        <CardBody>
          <Table
            columns={[
              { key: "id", title: "ID", align: "left" },
              { key: "requirement", title: "Requirement", align: "left" },
              { key: "priority", title: "Priority", align: "left" },
              { key: "verification", title: "Verification", align: "left" },
            ]}
            rows={nonFunctionalRows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3. Database Architecture" subtitle="Data model, storage strategy, and governance" />
        <CardBody>
          <Stack gap={10}>
            <Text>
              The platform uses a polyglot persistence model: relational OLTP for canonical data,
              columnar analytics warehouse for heavy aggregations, and in-memory cache for low-latency
              read patterns.
            </Text>
            <Grid columns={2} gap={12}>
              <Card variant="outlined" size="sm">
                <CardHeader title="Primary OLTP Store" />
                <CardBody>
                  <Text>PostgreSQL cluster with multi-AZ replication and point-in-time recovery.</Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Analytical Store" />
                <CardBody>
                  <Text>
                    Columnar warehouse for historical trend scans, co-occurrence matrices, and AI
                    feature materialization.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Cache Layer" />
                <CardBody>
                  <Text>Redis for query result caching, session state, and export job coordination.</Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Data Governance" />
                <CardBody>
                  <Text>
                    Strict schema evolution, data lineage tags, immutable source snapshots, and
                    retention policy enforcement.
                  </Text>
                </CardBody>
              </Card>
            </Grid>
            <Table
              columns={[
                { key: "table", title: "Logical Table", align: "left" },
                { key: "purpose", title: "Purpose", align: "left" },
                { key: "keyFields", title: "Key Fields", align: "left" },
                { key: "retention", title: "Retention", align: "left" },
              ]}
              rows={dbTables}
            />
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="4. API Architecture" subtitle="Service contracts and integration boundaries" />
        <CardBody>
          <Stack gap={10}>
            <Text>
              The API architecture follows an API-first model with OpenAPI 3.1 contracts, versioned
              REST resources, and asynchronous processing for long-running operations.
            </Text>
            <Grid columns={2} gap={12}>
              <Card variant="outlined" size="sm">
                <CardHeader title="Gateway" />
                <CardBody>
                  <Text>
                    Single API gateway provides authentication, request throttling, WAF policies,
                    schema validation, and observability headers.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Service Domains" />
                <CardBody>
                  <Text>
                    Draw Service, Analytics Service, Insight Service, Export Service, and Admin Service
                    are independently deployable bounded contexts.
                  </Text>
                </CardBody>
              </Card>
            </Grid>
            <Table
              columns={[
                { key: "endpoint", title: "Endpoint", align: "left" },
                { key: "purpose", title: "Purpose", align: "left" },
                { key: "security", title: "Security Controls", align: "left" },
              ]}
              rows={apiEndpoints}
            />
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="5. Frontend Architecture" subtitle="User experience, composition, and runtime behavior" />
        <CardBody>
          <Stack gap={10}>
            <Text>
              The frontend is a modular single-page web application using a domain-oriented component
              architecture and server-assisted rendering for critical pages.
            </Text>
            <Grid columns={3} gap={12}>
              <Card variant="outlined" size="sm">
                <CardHeader title="Presentation Layer" />
                <CardBody>
                  <Text>
                    Responsive dashboards, advanced filters, drill-down visualizations, and report
                    workbench.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="State Management" />
                <CardBody>
                  <Text>
                    Normalized client state for filters and preferences; server state cached with
                    stale-while-revalidate semantics.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Accessibility & I18N" />
                <CardBody>
                  <Text>
                    WCAG-compliant components, keyboard navigation, right-to-left support, Hebrew/English
                    localization.
                  </Text>
                </CardBody>
              </Card>
            </Grid>
            <Text>
              Frontend modules: Authentication, Draw Explorer, Statistical Insights, AI Explainability
              Panel, Saved Views, Alerts, and Admin Operations.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="6. Security Architecture" subtitle="Defense-in-depth and compliance controls" />
        <CardBody>
          <Grid columns={2} gap={12}>
            <Card variant="outlined" size="sm">
              <CardHeader title="Identity and Access" />
              <CardBody>
                <Text>OIDC/OAuth2 with short-lived JWT, optional MFA, and strict RBAC/ABAC controls.</Text>
              </CardBody>
            </Card>
            <Card variant="outlined" size="sm">
              <CardHeader title="Data Protection" />
              <CardBody>
                <Text>Field-level encryption for sensitive data, key rotation, secure secrets management.</Text>
              </CardBody>
            </Card>
            <Card variant="outlined" size="sm">
              <CardHeader title="Application Security" />
              <CardBody>
                <Text>
                  Secure coding baseline, dependency scanning, WAF, CSRF protections, CSP, and threat
                  modeling.
                </Text>
              </CardBody>
            </Card>
            <Card variant="outlined" size="sm">
              <CardHeader title="Monitoring and Response" />
              <CardBody>
                <Text>
                  Centralized SIEM, anomaly alerts, incident runbooks, immutable audit logs, and forensic
                  retention.
                </Text>
              </CardBody>
            </Card>
          </Grid>
          <Stack gap={6}>
            <H3>Mandatory Security Controls</H3>
            <Text>1) Least privilege everywhere 2) Quarterly penetration tests 3) Continuous vulnerability remediation</Text>
            <Text>4) Segmented networks 5) Signed artifacts 6) Mandatory pre-production security gates</Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="7. Analytics Engine Architecture" subtitle="Deterministic statistical computation pipeline" />
        <CardBody>
          <Stack gap={10}>
            <Text>
              The analytics engine is deterministic and reproducible. It computes time-windowed statistics
              over immutable historical draws and stores materialized aggregates for fast retrieval.
            </Text>
            <Grid columns={4} gap={10}>
              <Card variant="outlined" size="sm">
                <CardHeader title="Ingest" />
                <CardBody>
                  <Text>Acquire and validate historical draw data with source checksums.</Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Transform" />
                <CardBody>
                  <Text>Normalize numbers, derive windows, and build feature sets.</Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Compute" />
                <CardBody>
                  <Text>Run statistical jobs (frequency, gaps, streaks, pairings, trend deltas).</Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Serve" />
                <CardBody>
                  <Text>Expose aggregates through low-latency APIs and explainability metadata.</Text>
                </CardBody>
              </Card>
            </Grid>
            <Text>
              Determinism requirements: same input dataset and version must always produce byte-identical
              aggregate outputs and identical confidence intervals.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="8. AI Insights Architecture" subtitle="Governed generation for educational interpretation" />
        <CardBody>
          <Stack gap={10}>
            <Text>
              AI capabilities are constrained to explanation and educational interpretation of analytics
              outputs. The system must not generate betting recommendations, number picks, or certainty claims.
            </Text>
            <Grid columns={2} gap={12}>
              <Card variant="outlined" size="sm">
                <CardHeader title="Insight Pipeline" />
                <CardBody>
                  <Text>
                    Template selection -> feature retrieval -> prompt assembly -> model inference ->
                    policy validation -> explainability packaging.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Guardrails" />
                <CardBody>
                  <Text>
                    Prompt firewall, prohibited intent filters, hallucination checks, confidence banding,
                    and mandatory disclaimer injection.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Human Oversight" />
                <CardBody>
                  <Text>
                    Moderation queue for low-confidence or policy-sensitive outputs before user visibility.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Model Operations" />
                <CardBody>
                  <Text>
                    Versioned prompts/models, offline evaluation set, rollback strategy, and drift monitoring.
                  </Text>
                </CardBody>
              </Card>
            </Grid>
            <Text>
              Every AI response includes: data window, statistical basis summary, confidence band, and
              educational disclaimer version reference.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="9. Deployment Architecture" subtitle="Production topology and operational model" />
        <CardBody>
          <Stack gap={10}>
            <Text>
              Deployment target is cloud-native Kubernetes with separate environments (dev, staging, prod),
              immutable container images, and progressive rollout strategy.
            </Text>
            <Grid columns={3} gap={12}>
              <Card variant="outlined" size="sm">
                <CardHeader title="Runtime" />
                <CardBody>
                  <Text>
                    Multi-zone Kubernetes clusters, autoscaling services, service mesh mTLS, and policy
                    enforcement.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Delivery" />
                <CardBody>
                  <Text>
                    CI/CD with signed artifacts, infrastructure as code, canary releases, automated rollback.
                  </Text>
                </CardBody>
              </Card>
              <Card variant="outlined" size="sm">
                <CardHeader title="Reliability" />
                <CardBody>
                  <Text>
                    SLO-based alerting, distributed tracing, centralized logs, runbooks, and on-call escalation.
                  </Text>
                </CardBody>
              </Card>
            </Grid>
            <Text>
              Backup strategy: database snapshots every 15 minutes, daily full backups, cross-region replication,
              and regular restoration drills.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="10. Development Roadmap" subtitle="Phased delivery plan with enterprise gates" />
        <CardBody>
          <Table
            columns={[
              { key: "phase", title: "Phase", align: "left" },
              { key: "deliverables", title: "Key Deliverables", align: "left" },
              { key: "exitCriteria", title: "Exit Criteria", align: "left" },
            ]}
            rows={roadmap}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Appendix A - Assumptions and Constraints" />
        <CardBody>
          <Stack gap={6}>
            <Text>
              Assumptions: Official draw data remains accessible via licensed/approved channels; user demand
              justifies near-real-time ingestion; legal framework permits educational analytics dissemination.
            </Text>
            <Text>
              Constraints: No betting advisory functionality, no payout optimization recommendations, strict
              AI policy guardrails, and enterprise security controls mandatory for every release.
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
