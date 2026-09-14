import { Link } from "react-router-dom";
import type { Payment } from "../types/investments";
import { formatDate, formatMoney } from "../utils/format";

export function InvestorHeroCard({
  greeting,
  principal,
  nextPayment,
  paidThisYear,
  onDownloadMonthly,
  monthlyBusy,
}: {
  greeting?: string;
  principal: number;
  nextPayment?: Payment | null;
  paidThisYear: number;
  onDownloadMonthly?: () => void;
  monthlyBusy?: boolean;
}) {
  const nextIsAwaiting = nextPayment?.status === "awaiting_confirmation";

  return (
    <section className="investor-hero" aria-label="התיק הפרטי">
      <h1 className="investor-hero__title">
        {greeting ? `שלום ${greeting}` : "התיק הפרטי"}
      </h1>
      <div className="investor-hero__fund">
        <span>הקרן</span>
        <strong>{formatMoney(principal)}</strong>
      </div>
      <div className="investor-hero__grid">
        <div className="investor-hero__cell">
          <span>התשלום הבא</span>
          {nextPayment ? (
            <>
              <strong>{formatMoney(nextPayment.investor_amount)}</strong>
              <em className="hide-on-phone">
                {formatDate(nextPayment.due_date)}
                {nextIsAwaiting ? " · ממתין לאישורך" : ""}
              </em>
            </>
          ) : (
            <>
              <strong className="investor-hero__quiet">אין תשלום מתוכנן</strong>
              <em className="hide-on-phone">נעדכן כאן כשיהיה מועד הבא</em>
            </>
          )}
        </div>
        <div className="investor-hero__cell">
          <span>שולם השנה</span>
          <strong>{formatMoney(paidThisYear)}</strong>
          <em className="hide-on-phone">מזומן שהגיע אליך</em>
        </div>
      </div>
      <div className="investor-hero__actions">
        {onDownloadMonthly ? (
          <button
            type="button"
            className="btn btn--gold"
            disabled={monthlyBusy}
            onClick={onDownloadMonthly}
          >
            {monthlyBusy ? "מכינים דוח..." : "דוח חודשי"}
          </button>
        ) : null}
        <Link className="btn btn--ghost hide-on-phone" to="/documents">
          כספת מסמכים
        </Link>
        <Link className="btn btn--ghost hide-on-phone" to="/payments">
          לתשלומים
        </Link>
      </div>
    </section>
  );
}
