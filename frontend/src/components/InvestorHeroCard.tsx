import { Link } from "react-router-dom";
import type { Payment, Plan } from "../types/investments";
import { addMonthsISO, formatDate, formatMoney, todayISO } from "../utils/format";
import { HeroDepth } from "./motion/HeroDepth";
import { MotionButton } from "./motion/MotionButton";
import "./dashboardClarity.css";
import "./investorHome.css";

/** Whole months from start until today (0..duration). Display only. */
function monthsElapsed(start: string, today: string, duration: number): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - sy) * 12 + (tm - sm);
  if (td < sd) months -= 1;
  return Math.max(0, Math.min(duration, months));
}

function PlanJourney({ plan, today }: { plan: Plan; today: string }) {
  // Same end date as the agreement and the plan card: start + duration.
  const end = addMonthsISO(plan.start_date, plan.duration_months);
  const started = plan.start_date <= today;
  const done = monthsElapsed(plan.start_date, today, plan.duration_months);
  const current = Math.min(plan.duration_months, done + 1);
  const percent = started ? Math.round((done / Math.max(plan.duration_months, 1)) * 100) : 0;
  const hasSavings = (plan.savings_rate_percent || 0) > 0;
  const left = plan.duration_months - done;
  return (
    <div className="investor-journey">
      <div className="investor-journey__head">
        <strong>{started ? `חודש ${current} מתוך ${plan.duration_months}` : `המסלול מתחיל ב־${formatDate(plan.start_date)}`}</strong>
        <span>{started ? (left > 0 ? `עוד ${left} חודשים · מסתיים ב־${formatDate(end)}` : `התקופה הסתיימה ב־${formatDate(end)}`) : `${plan.duration_months} חודשים`}</span>
      </div>
      <div
        className="investor-journey__bar"
        role="progressbar"
        aria-label="התקדמות במסלול"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="investor-journey__end">
        <strong>מה קורה בסוף?</strong>{" "}
        {hasSavings
          ? `הקרן (${formatMoney(plan.principal)}) והחיסכון שנצבר עוברים ליתרה הזמינה שלך, לאחר חתימה על הסכם סיום.`
          : `הקרן (${formatMoney(plan.principal)}) עוברת ליתרה הזמינה שלך, לאחר חתימה על הסכם סיום.`}{" "}
        משם אפשר למשוך את הכסף או להמשיך למסלול חדש — ההחלטה שלך.
      </p>
    </div>
  );
}

export function InvestorHeroCard({
  greeting,
  principal,
  nextPayment,
  paidThisYear,
  paidLifetime,
  savingsBalance = 0,
  availableBalance = 0,
  activePlans = [],
  onDownloadMonthly,
  monthlyBusy,
}: {
  greeting?: string;
  principal: number;
  nextPayment?: Payment | null;
  paidThisYear: number;
  paidLifetime?: number;
  savingsBalance?: number;
  availableBalance?: number;
  activePlans?: Plan[];
  onDownloadMonthly?: () => void;
  monthlyBusy?: boolean;
}) {
  const today = todayISO();
  const nextIsAwaiting = nextPayment?.status === "awaiting_confirmation";
  const paymentOverdue = nextPayment && nextPayment.due_date < today;
  const hasSavingsPlan = activePlans.some((p) => (p.savings_rate_percent || 0) > 0);
  const showSavings = hasSavingsPlan || savingsBalance > 0;
  const showAvailable = availableBalance > 0;
  const plan = activePlans[0];

  return (
    <HeroDepth className="investor-hero investor-hero--overview" aria-label="ההשקעה שלך">
      <h1 className="investor-hero__title">{greeting ? `שלום ${greeting}` : "ההשקעה שלך"}</h1>
      <p className="investor-overview__intro">ההשקעה שלך במבט אחד</p>

      {plan ? <PlanJourney plan={plan} today={today} /> : null}

      <div className="investor-overview__grid">
        <div className="investor-hero__cell">
          <span>הכסף שהשקעת</span>
          <strong>{formatMoney(principal)}</strong>
          <em>הקרן שעובדת עבורך עכשיו</em>
        </div>
        <div className="investor-hero__cell">
          <span>{nextIsAwaiting ? "ממתין לאישור שלך" : paymentOverdue ? "תשלום שטרם הושלם" : "התשלום הבא"}</span>
          {nextPayment ? (
            <>
              <strong>{formatMoney(nextPayment.investor_amount, true)}</strong>
              <em className="investor-hero__note">
                {formatDate(nextPayment.due_date)}
                {nextPayment.date_amendment_pending ? " · ממתין לחתימת הסכם" : nextIsAwaiting ? " · אשר/י למטה" : ""}
              </em>
            </>
          ) : (
            <>
              <strong className="investor-hero__quiet">אין תשלום מתוכנן</strong>
              <em className="investor-hero__note">נעדכן כאן כשיהיה מועד הבא</em>
            </>
          )}
        </div>
        <div className="investor-hero__cell">
          <span>קיבלת עד היום</span>
          <strong>{formatMoney(paidLifetime ?? paidThisYear)}</strong>
          <em>{paidLifetime != null && paidLifetime !== paidThisYear ? `מתוכם ${formatMoney(paidThisYear)} השנה` : "סך התשלומים שהתקבלו"}</em>
        </div>
        {showSavings ? (
          <div className="investor-hero__cell">
            <span>חיסכון שנצבר</span>
            <strong>{formatMoney(savingsBalance)}</strong>
            <em>נצבר בנוסף לקרן, עד היום</em>
          </div>
        ) : null}
        {showAvailable ? (
          <div className="investor-hero__cell">
            <span>יתרה זמינה</span>
            <strong>{formatMoney(availableBalance)}</strong>
            <em>אפשר למשוך או להשקיע מחדש</em>
          </div>
        ) : null}
      </div>

      <details className="investor-explain">
        <summary>מה המספרים אומרים?</summary>
        <dl>
          <dt>הכסף שהשקעת</dt>
          <dd>הסכום שהעברת להשקעה. הוא נשאר שלך לאורך כל התקופה וחוזר אליך בסופה.</dd>
          <dt>התשלום הבא</dt>
          <dd>הסכום שתקבל/י במזומן בחודש הקרוב. כשההעברה נשלחת, תתבקש/י לאשר שקיבלת.</dd>
          <dt>קיבלת עד היום</dt>
          <dd>סך כל התשלומים החודשיים שכבר קיבלת ואישרת — מעבר לקרן.</dd>
          {showSavings ? (
            <>
              <dt>חיסכון שנצבר</dt>
              <dd>רווח שלא משולם כל חודש אלא נצבר בצד, ומצטרף אליך בסוף המסלול.</dd>
            </>
          ) : null}
          {showAvailable ? (
            <>
              <dt>יתרה זמינה</dt>
              <dd>כסף שכבר לא נמצא במסלול ומחכה להחלטה שלך: משיכה או מסלול חדש. הוא לא צובר רווח.</dd>
            </>
          ) : null}
        </dl>
      </details>

      <div className="investor-hero__actions">
        <Link className="btn btn--primary" to="/investors">לפרטי ההשקעה</Link>
        <Link className="btn btn--ghost" to="/payments">התשלומים שלי</Link>
        {onDownloadMonthly ? (
          <MotionButton
            type="button"
            className="btn btn--ghost investor-hero__cta"
            disabled={monthlyBusy}
            onClick={onDownloadMonthly}
          >
            {monthlyBusy ? "מכינים דוח..." : "דוח חודשי (PDF)"}
          </MotionButton>
        ) : null}
      </div>
    </HeroDepth>
  );
}
