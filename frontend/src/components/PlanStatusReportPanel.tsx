import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import type { PlanStatusReport } from "../types/investments";
import {
  formatCalendarMonth,
  formatDate,
  formatMoney,
  statusLabel,
} from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";

export function PlanStatusReportPanel({
  planId,
  title,
  year,
}: {
  planId: number;
  title?: string;
  /** When set, only months in this calendar year are shown (from actual start). */
  year?: number;
}) {
  const [report, setReport] = useState<PlanStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .planStatusReport(planId, year != null ? { year } : undefined)
      .then((res) => {
        if (alive) setReport(res);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || "טעינת דוח המצב נכשלה");
      });
    return () => {
      alive = false;
    };
  }, [planId, year]);

  const months = useMemo(() => report?.months ?? [], [report]);

  if (error) return <p className="form-error">{error}</p>;
  if (!report) return <p className="muted">טוען דוח מצב...</p>;
  if (months.length === 0) {
    return (
      <p className="muted">
        אין חודשים להצגה
        {year ? ` בשנת ${year}` : ""} — המשקיע לא היה במסלול בתקופה הזו.
      </p>
    );
  }

  const showSavings = report.plan_type !== "monthly";
  const showCash = report.plan_type !== "savings";
  const startLabel = formatCalendarMonth(report.start_date);

  return (
    <div className="status-report">
      <div className="page-head__actions" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "הסתר דוח מצב" : "הצג דוח מצב מתחילת המסלול עד סופו"}
        </button>
      </div>
      {!open ? null : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {title ?? `${planTypeLabel(report.plan_type)} · לפי תנאי המסלול`}
            {" · "}
            תחילת מסלול: {startLabel}
            {" · "}
            סוף מסלול: {formatCalendarMonth(
              report.months.length
                ? report.months[report.months.length - 1].due_date
                : report.start_date,
            )}
            {year ? ` · מסונן לשנת ${year}` : ""}
            {" · "}
            מזומן ששולם: {formatMoney(report.paid_cash_total)}
            {showSavings
              ? ` · יתרת חיסכון נוכחית: ${formatMoney(report.current_savings_balance)}`
              : null}
            {showSavings
              ? ` · חיסכון צפוי בסיום: ${formatMoney(report.projected_savings_balance)}`
              : null}
          </p>
          <div className="table-wrap">
            <table className="table table--stackable">
              <thead>
                <tr>
                  <th>חודש #</th>
                  <th>חודש</th>
                  <th>תאריך</th>
                  {showCash ? <th>מקבל (מזומן)</th> : null}
                  {showSavings ? <th>נכנס לחיסכון</th> : null}
                  {showSavings ? <th>יתרת חיסכון</th> : null}
                  {showCash ? <th>מזומן מצטבר</th> : null}
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month_number}>
                    <td data-label="חודש #">
                      {m.month_number}
                      {m.compounded ? " · ריבית דריבית" : ""}
                    </td>
                    <td data-label="חודש">{formatCalendarMonth(m.due_date)}</td>
                    <td data-label="תאריך">{formatDate(m.due_date)}</td>
                    {showCash ? (
                      <td data-label="מקבל (מזומן)">{formatMoney(m.cash_amount, true)}</td>
                    ) : null}
                    {showSavings ? (
                      <td data-label="נכנס לחיסכון">{formatMoney(m.savings_accrual, true)}</td>
                    ) : null}
                    {showSavings ? (
                      <td data-label="יתרת חיסכון">{formatMoney(m.cumulative_savings)}</td>
                    ) : null}
                    {showCash ? (
                      <td data-label="מזומן מצטבר">{formatMoney(m.cumulative_cash)}</td>
                    ) : null}
                    <td data-label="סטטוס">
                      <span className={`badge badge--${m.status}`}>
                        {statusLabel(m.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
