import { FlowFunnel, NextActionsHub, type NextAction } from "./FlowFunnel";
import { formatMoney } from "../utils/format";
import type { Dashboard, Quote, TopupRequest } from "../types/investments";
import { isPipelineQuote, normalizeQuoteStatus } from "../utils/quoteStatus";

const ADMIN_FUNNEL = [
  { id: "quote", label: "הצעה", hint: "PDF + וואטסאפ" },
  { id: "approve", label: "אישור", hint: "סימון כאושר" },
  { id: "convert", label: "קליטה", hint: "הכנס כמשקיע" },
  { id: "access", label: "כניסה", hint: "פרטי התחברות" },
  { id: "pay", label: "תשלומים", hint: "שלח לאישור" },
];

type Props = {
  isAdmin: boolean;
  isManager: boolean;
  dashboard: Dashboard;
  topupRequests: TopupRequest[] | null;
  quotes?: Quote[] | null;
};

/** Manager/admin guided funnel. Investor dashboard no longer shows a journey block. */
export function RoleJourneyHub({
  isAdmin,
  isManager,
  dashboard,
  topupRequests,
  quotes,
}: Props) {
  if (!isAdmin && !isManager) return null;

  const upcomingCount = (dashboard.upcoming_payments ?? []).length;
  const pendingTopups = (topupRequests ?? []).filter(
    (r) => r.status === "pending" || r.status === "contract",
  );
  const pipelineQuotes = (quotes ?? []).filter((q) => isPipelineQuote(q.status));
  const approvedQuotes = (quotes ?? []).filter(
    (q) => normalizeQuoteStatus(q.status) === "approved",
  );

  const actions: NextAction[] = [];

  if (pipelineQuotes.length > 0) {
    actions.push({
      id: "quotes-pipeline",
      eyebrow: "משפך הצעות",
      title: `${pipelineQuotes.length} הצעות בתהליך`,
      detail:
        approvedQuotes.length > 0
          ? `${approvedQuotes.length} ממתינות לקליטה אחרי העברת כסף.`
          : "שלחו PDF, סמנו כאושר, ואז הכניסו כמשקיע.",
      cta: "למסך הצעות",
      to: "/quotes",
      tone: "admin",
    });
  }

  if (pendingTopups.length > 0) {
    actions.push({
      id: "topups",
      eyebrow: "בקשות מסלול",
      title: `${pendingTopups.length} ממתינות לטיפול`,
      detail: "חוזה, חתימה או אישור סכום — פתחו את כרטיס המשקיע.",
      cta: "לטפל בבקשות",
      to: "/investors",
      tone: "admin",
    });
  }

  if (upcomingCount > 0) {
    const first = dashboard.upcoming_payments[0];
    actions.push({
      id: "payments",
      eyebrow: "תשלומים קרובים",
      title: `${upcomingCount} תשלומים מתוכננים`,
      detail: first
        ? `הבא: ${first.investor_name} · ${formatMoney(
            isAdmin ? first.manager_amount : first.investor_amount,
          )}`
        : "שלחו לאישור משקיע כשהכסף יצא.",
      cta: "למסך תשלומים",
      to: "/payments",
      tone: "admin",
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "new-quote",
      eyebrow: "התחלה",
      title: "פתחו הצעה למשקיע חדש",
      detail: "משפך מלא: הצעה → אישור → קליטה → כניסה → תשלומים.",
      cta: "הצעה חדשה",
      to: "/quotes",
      tone: "admin",
    });
  }

  const funnelCurrent =
    approvedQuotes.length > 0
      ? 2
      : pipelineQuotes.length > 0
        ? 0
        : pendingTopups.length > 0
          ? 3
          : 4;

  return (
    <div className="journey-block">
      <FlowFunnel
        title={isAdmin ? "משפך ניהול · ADMIN" : "משפך ניהול"}
        subtitle="מהשלב הנוכחי עד תשלום חודשי — צעד אחד בכל פעם"
        steps={ADMIN_FUNNEL}
        current={Math.min(funnelCurrent, ADMIN_FUNNEL.length - 1)}
      />
      <NextActionsHub
        title="מה לעשות עכשיו"
        subtitle="חלוניות פעולה לפי מה שממתין אצלך"
        actions={actions.slice(0, 3)}
      />
    </div>
  );
}
