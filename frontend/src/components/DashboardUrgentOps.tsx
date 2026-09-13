import { Link } from "react-router-dom";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatMoney, todayISO } from "../utils/format";
import {
  buildUrgentPaymentOps,
  overdueMonthsLabel,
  type UrgentInvestorRow,
} from "../utils/paymentOps";

type Props = {
  investorId?: number | null;
};

function currentYearFromToday(today: string): number {
  return Number(today.slice(0, 4));
}

function currentMonthNumber(today: string): number {
  return Number(today.slice(5, 7));
}

function statusHint(status: string): string {
  if (status === "awaiting_confirmation") return "נשלח · ממתין לאישור";
  if (status === "scheduled") return "טרם הועבר";
  return "חסר תשלום";
}

function VisibleRows({
  rows,
  monthHint,
}: {
  rows: UrgentInvestorRow[];
  monthHint?: string;
}) {
  const visible = rows.slice(0, 4);
  const extra = rows.length - visible.length;
  return (
    <ul className="urgent-card__list">
      {visible.map((row) => (
        <li key={`${row.investorId}-${row.dueDate}`} className="urgent-card__row">
          <div>
            <strong>{row.investorName}</strong>
            <span className="muted">
              {monthHint ? `${monthHint} · ` : ""}
              {statusHint(row.status)}
            </span>
          </div>
          <span className="urgent-card__amount">{formatMoney(row.amount)}</span>
        </li>
      ))}
      {extra > 0 ? (
        <li className="urgent-card__more muted">ועוד {extra} משקיעים</li>
      ) : null}
    </ul>
  );
}

export function DashboardUrgentOps({ investorId = null }: Props) {
  const today = todayISO();
  const year = currentYearFromToday(today);
  const includePrevYear = currentMonthNumber(today) === 1;

  const { data: yearPayments, loading, error, reload } = useAsync(
    () =>
      api.payments({
        year,
        investor_id: investorId ?? undefined,
      }),
    [year, investorId],
  );

  const { data: prevYearPayments } = useAsync(
    () =>
      includePrevYear
        ? api.payments({
            year: year - 1,
            investor_id: investorId ?? undefined,
          })
        : Promise.resolve([]),
    [includePrevYear, year, investorId],
  );

  if (loading && !yearPayments) {
    return (
      <section className="urgent-ops" aria-label="דחוף עכשיו">
        <p className="urgent-ops__loading muted">בודק תשלומים לחודש הנוכחי...</p>
      </section>
    );
  }

  if (error && !yearPayments) {
    return (
      <section className="urgent-ops" aria-label="דחוף עכשיו">
        <article className="urgent-card urgent-card--missing">
          <p className="urgent-card__eyebrow">תשלומים</p>
          <h2 className="urgent-card__title">לא ניתן לבדוק תשלומים דחופים</h2>
          <p className="urgent-card__detail">{error}</p>
          <button type="button" className="btn btn--small btn--admin" onClick={reload}>
            נסה שוב
          </button>
        </article>
      </section>
    );
  }

  const ops = buildUrgentPaymentOps(
    [...(yearPayments ?? []), ...(prevYearPayments ?? [])],
    today,
    investorId,
  );
  const missing = ops.missingThisMonth;
  const overdue = ops.overdueTransfers;
  const missingTotal = missing.reduce((sum, row) => sum + row.amount, 0);
  const overdueTotal = overdue.reduce((sum, row) => sum + row.amount, 0);
  const overdueLabel = overdueMonthsLabel(ops.overdueMonthKeys);

  return (
    <section className="urgent-ops" aria-label="דחוף עכשיו">
      <header className="urgent-ops__head">
        <h2 className="urgent-ops__title">דחוף עכשיו</h2>
        <p className="urgent-ops__subtitle">מידע לחוץ בלבד — בלי משפך שלבים</p>
      </header>

      {overdue.length > 0 ? (
        <article className="urgent-card urgent-card--overdue" aria-label="העברה חודשית שעבר מועדה">
          <p className="urgent-card__eyebrow">תזכורת · עבר חודש</p>
          <h3 className="urgent-card__title">
            {overdue.length === 1
              ? `${overdue[0].investorName} ממתין להעברה חודשית`
              : `${overdue.length} משקיעים ממתינים להעברה חודשית`}
          </h3>
          <p className="urgent-card__detail">
            עבר מועד {overdueLabel || "החודש הקודם"} · {formatMoney(overdueTotal)} טרם הועבר.
            פתחו תשלומים ושלחו לאישור.
          </p>
          <VisibleRows rows={overdue} />
          <Link className="btn btn--small btn--gold" to="/payments">
            לטפל בהעברה
          </Link>
        </article>
      ) : null}

      {missing.length > 0 ? (
        <article className="urgent-card urgent-card--missing" aria-label="חסר תשלום החודש">
          <p className="urgent-card__eyebrow">דחוף · {ops.currentMonthLabel}</p>
          <h3 className="urgent-card__title">
            {missing.length === 1
              ? `${missing[0].investorName} לא קיבל תשלום החודש`
              : `${missing.length} משקיעים לא קיבלו תשלום ב${ops.currentMonthLabel}`}
          </h3>
          <p className="urgent-card__detail">
            סה״כ {formatMoney(missingTotal)} שעדיין לא סומן כבוצע לחודש הנוכחי.
          </p>
          <VisibleRows rows={missing} monthHint={ops.currentMonthLabel} />
          <Link className="btn btn--small btn--admin" to="/payments">
            לתשלומים
          </Link>
        </article>
      ) : null}

      {overdue.length === 0 && missing.length === 0 ? (
        <article className="urgent-card urgent-card--ok" aria-label="אין תשלומים דחופים">
          <p className="urgent-card__eyebrow">מעודכן · {ops.currentMonthLabel}</p>
          <h3 className="urgent-card__title">אין תשלום חסר החודש</h3>
          <p className="urgent-card__detail">
            אין משקיעים שממתינים להעברה חודשית שעבר מועדה, ואין תשלום פתוח לחודש הנוכחי.
          </p>
          <Link className="btn btn--small btn--ghost" to="/payments">
            למסך תשלומים
          </Link>
        </article>
      ) : null}
    </section>
  );
}
