import { Link } from "react-router-dom";
import { FlowFunnel, NextActionsHub, type NextAction } from "./FlowFunnel";
import { formatMoney, statusLabel } from "../utils/format";
import type { Dashboard, Quote, TopupRequest } from "../types/investments";
import { isPipelineQuote, normalizeQuoteStatus } from "../utils/quoteStatus";

const ADMIN_FUNNEL = [
  { id: "quote", label: "הצעה", hint: "PDF + וואטסאפ" },
  { id: "approve", label: "אישור", hint: "סימון כאושר" },
  { id: "convert", label: "קליטה", hint: "הכנס כמשקיע" },
  { id: "access", label: "כניסה", hint: "פרטי התחברות" },
  { id: "pay", label: "תשלומים", hint: "שלח לאישור" },
];

const INVESTOR_FUNNEL = [
  { id: "track", label: "המסלול", hint: "קרן וחיסכון" },
  { id: "await", label: "תשלום", hint: "ממתין אצלך" },
  { id: "confirm", label: "אישור", hint: "אשר קבלה" },
  { id: "grow", label: "צמיחה", hint: "בקשת מסלול" },
];

type Props = {
  isAdmin: boolean;
  isManager: boolean;
  dashboard: Dashboard;
  topupRequests: TopupRequest[] | null;
  quotes?: Quote[] | null;
  awaitingConfirmCount?: number;
};

export function RoleJourneyHub({
  isAdmin,
  isManager,
  dashboard,
  topupRequests,
  quotes,
  awaitingConfirmCount = 0,
}: Props) {
  const upcomingCount = (dashboard.upcoming_payments ?? []).length;
  const pendingTopups = (topupRequests ?? []).filter(
    (r) => r.status === "pending" || r.status === "contract",
  );
  const pipelineQuotes = (quotes ?? []).filter((q) => isPipelineQuote(q.status));
  const approvedQuotes = (quotes ?? []).filter(
    (q) => normalizeQuoteStatus(q.status) === "approved",
  );

  if (isAdmin || isManager) {
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

  const investorActions: NextAction[] = [];
  const cooling = (topupRequests ?? []).filter((r) => r.can_reverse_investment);
  const contract = (topupRequests ?? []).filter((r) => r.status === "contract");

  if (awaitingConfirmCount > 0) {
    investorActions.push({
      id: "confirm-pay",
      eyebrow: "דחוף",
      title: `${awaitingConfirmCount} תשלומים ממתינים לאישור`,
      detail: "המנהל שלח בקשה — אשרו או דחו בחלונית התשלומים.",
      cta: "לאשר עכשיו",
      to: "/payments",
      tone: "gold",
    });
  }

  if (contract.length > 0) {
    investorActions.push({
      id: "sign",
      eyebrow: "חתימה",
      title: "חוזה ממתין לחתימה שלך",
      detail: `${formatMoney(contract[0].amount)} · ${statusLabel(contract[0].status)}`,
      cta: "לחתימה",
      to: "/investors",
      tone: "gold",
    });
  }

  investorActions.push({
    id: "payments",
    eyebrow: "תשלומים",
    title: upcomingCount > 0 ? `${upcomingCount} תשלומים קרובים` : "התשלומים שלי",
    detail: "כאן מאשרים קבלה כשמגיע תשלום מהמנהל.",
    cta: "לפתיחה",
    to: "/payments",
    tone: "gold",
  });

  if (cooling.length > 0) {
    investorActions.push({
      id: "cooling",
      eyebrow: "חלון ביטול",
      title: "השקעה חדשה בחלון ביטול",
      detail: cooling[0].cooling_off_days_left
        ? `נותרו ${cooling[0].cooling_off_days_left} ימי עסקים לביטול.`
        : "ניתן לבטל בימי העסקים הקרובים.",
      cta: "לפרטים",
      to: "/investors",
      tone: "default",
    });
  } else if (investorActions.length < 3) {
    investorActions.push({
      id: "topup",
      eyebrow: "צמיחה",
      title: "רוצים להוסיף מסלול?",
      detail: "בקשה קצרה למנהל — חוזה וחתימה בחלונית נוחה.",
      cta: "בקשת מסלול",
      to: "/investors",
      tone: "gold",
    });
  }

  const investorStep = awaitingConfirmCount > 0 ? 2 : contract.length > 0 ? 1 : 0;

  return (
    <div className="journey-block">
      <FlowFunnel
        title="המסלול שלך"
        subtitle="ממעקב יומיומי עד אישור קבלה — הכל במקום אחד"
        steps={INVESTOR_FUNNEL}
        current={investorStep}
      />
      <NextActionsHub
        title="הצעד הבא שלך"
        subtitle="לחצו על חלונית כדי להמשיך"
        actions={investorActions.slice(0, 3)}
        empty={
          <p className="muted">
            הכל מעודכן.{" "}
            <Link className="text-link" to="/payments">
              לתשלומים
            </Link>
          </p>
        }
      />
    </div>
  );
}
