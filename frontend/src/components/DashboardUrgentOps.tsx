import { Link } from "react-router-dom";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatCalendarMonth, formatMoney, todayISO } from "../utils/format";
import {
  buildUrgentPaymentOps,
  overdueMonthsLabel,
  paymentsFocusHref,
  primaryUrgentRow,
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
        <li key={`${row.investorId}-${row.dueDate}`}>
          <Link
            className="urgent-card__row"
            to={paymentsFocusHref(row)}
            aria-label={`לטפל בהעברה של ${row.investorName}`}
          >
            <div>
              <strong>{row.investorName}</strong>
              <span className="muted">
                {`${monthHint || formatCalendarMonth(row.dueDate)} · `}
                {statusHint(row.status)}
              </span>
            </div>
            <span className="urgent-card__amount">{formatMoney(row.amount)}</span>
          </Link>
        </li>
      ))}
      {extra > 0 ? (
        <li className="urgent-card__more muted">ועוד {extra}</li>
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
  const overdueFocus = primaryUrgentRow(overdue);
  const missingFocus = primaryUrgentRow(missing);

  return (
    <section className="urgent-ops" aria-label="דחוף עכשיו">
      <header className="urgent-ops__head">
        <h2 className="urgent-ops__title">דחוף עכשיו</h2>
      </header>

      {overdue.length > 0 ? (
        <article className="urgent-card urgent-card--overdue" aria-label="העברה חודשית שעבר מועדה">
          <p className="urgent-card__eyebrow">עבר מועד · {overdueLabel || "חודש קודם"}</p>
          <p className="urgent-card__hero">{formatMoney(overdueTotal)}</p>
          <h3 className="urgent-card__title">
            {overdue.length === 1
              ? `${overdue[0].investorName} ממתין להעברה`
              : `${overdue.length} ממתינים להעברה`}
          </h3>
          <VisibleRows rows={overdue} />
          <Link
            className="btn btn--small btn--gold"
            to={overdueFocus ? paymentsFocusHref(overdueFocus) : "/payments"}
          >
            לטפל בהעברה
          </Link>
        </article>
      ) : null}

      {missing.length > 0 ? (
        <article className="urgent-card urgent-card--missing" aria-label="חסר תשלום החודש">
          <p className="urgent-card__eyebrow">{ops.currentMonthLabel}</p>
          <p className="urgent-card__hero">{formatMoney(missingTotal)}</p>
          <h3 className="urgent-card__title">
            {missing.length === 1
              ? `${missing[0].investorName} טרם קיבל החודש`
              : `${missing.length} טרם קיבלו ב${ops.currentMonthLabel}`}
          </h3>
          <VisibleRows rows={missing} monthHint={ops.currentMonthLabel} />
          <Link
            className="btn btn--small btn--admin"
            to={missingFocus ? paymentsFocusHref(missingFocus) : "/payments"}
          >
            לתשלומים
          </Link>
        </article>
      ) : null}

      {overdue.length === 0 && missing.length === 0 ? (
        <article className="urgent-card urgent-card--ok" aria-label="אין תשלומים דחופים">
          <p className="urgent-card__eyebrow">{ops.currentMonthLabel}</p>
          <h3 className="urgent-card__title">הכול מעודכן</h3>
          <p className="urgent-card__detail">אין תשלום חסר החודש.</p>
          <Link className="btn btn--small btn--ghost hide-on-phone" to="/payments">
            לתשלומים
          </Link>
        </article>
      ) : null}
    </section>
  );
}
