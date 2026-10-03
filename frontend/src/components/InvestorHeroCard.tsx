import { Link } from "react-router-dom";
import type { Payment } from "../types/investments";
import { formatDate, formatMoney, todayISO } from "../utils/format";
import { HeroDepth } from "./motion/HeroDepth";
import { MotionButton } from "./motion/MotionButton";
import "./dashboardClarity.css";

export function InvestorHeroCard({
  greeting,
  principal,
  nextPayment,
  paidThisYear,
  savingsBalance = 0,
  availableBalance = 0,
  onDownloadMonthly,
  monthlyBusy,
}: {
  greeting?: string;
  principal: number;
  nextPayment?: Payment | null;
  paidThisYear: number;
  savingsBalance?: number;
  availableBalance?: number;
  onDownloadMonthly?: () => void;
  monthlyBusy?: boolean;
}) {
  const nextIsAwaiting = nextPayment?.status === "awaiting_confirmation";
  const paymentOverdue = nextPayment && nextPayment.due_date < todayISO();

  return (
    <HeroDepth className="investor-hero investor-hero--overview" aria-label="התיק הפרטי">
      <h1 className="investor-hero__title">
        {greeting ? `שלום ${greeting}` : "התיק הפרטי"}
      </h1>
      <p className="investor-overview__intro">ההשקעה שלך במבט אחד</p>
      <div className="investor-overview__grid">
        <div className="investor-hero__cell">
          <span>קרן במסלול פעיל</span>
          <strong>{formatMoney(principal)}</strong>
          <em>הסכום שהושקע במסלול</em>
        </div>
        <div className="investor-hero__cell">
          <span>חיסכון שנצבר</span>
          <strong>{formatMoney(savingsBalance)}</strong>
          <em>היתרה שנצברה עד היום</em>
        </div>
        <div className="investor-hero__cell">
          <span>יתרה זמינה</span>
          <strong>{formatMoney(availableBalance)}</strong>
          <em>למשיכה או למסלול הבא</em>
        </div>
        <div className="investor-hero__cell">
          <span>{nextIsAwaiting ? "תשלום הממתין לאישורך" : paymentOverdue ? "תשלום שטרם הושלם" : "התשלום הבא"}</span>
          {nextPayment ? (
            <>
              <strong>{formatMoney(nextPayment.investor_amount, true)}</strong>
              <em className="investor-hero__note">
                {formatDate(nextPayment.due_date)}
                {nextPayment.date_amendment_pending ? " · ממתין לחתימת הסכם" : nextIsAwaiting ? " · ממתין לאישורך" : ""}
              </em>
            </>
          ) : (
            <>
              <strong className="investor-hero__quiet">אין תשלום מתוכנן</strong>
              <em className="investor-hero__note">נעדכן כאן כשיהיה מועד הבא</em>
            </>
          )}
        </div>
      </div>
      <div className="investor-hero__actions">
        <Link className="btn btn--primary" to="/investors">לתיק ההשקעה</Link>
        {onDownloadMonthly ? (
          <MotionButton
            type="button"
            className="btn btn--ghost investor-hero__cta"
            disabled={monthlyBusy}
            onClick={onDownloadMonthly}
          >
            {monthlyBusy ? "מכינים דוח..." : "דוח חודשי"}
          </MotionButton>
        ) : null}
        <Link className="btn btn--ghost" to="/payments">
          לתשלומים
        </Link>
      </div>
      <p className="investor-overview__paid">מזומן ששולם לך השנה <strong>{formatMoney(paidThisYear)}</strong></p>
    </HeroDepth>
  );
}
