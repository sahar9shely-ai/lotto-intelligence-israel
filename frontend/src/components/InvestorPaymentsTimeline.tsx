import type { Payment } from "../types/investments";
import { formatCalendarMonth, formatDate, formatMoney, todayISO } from "../utils/format";
import "./investorHome.css";

/** Investor view of one year: what's next, what's waiting, what already arrived. */
export function InvestorPaymentsTimeline({ payments }: { payments: Payment[] }) {
  const today = todayISO();
  const sorted = [...payments].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const paid = sorted.filter((p) => p.status === "paid");
  const awaiting = sorted.filter((p) => p.status === "awaiting_confirmation");
  const upcoming = sorted.filter((p) => p.status === "scheduled");
  // Payments waiting for confirmation are shown in the confirmation card above the list.
  const next = upcoming[0] ?? null;
  const later = upcoming.filter((p) => p !== next);
  const paidTotal = paid.reduce((sum, p) => sum + (p.investor_amount || 0), 0);

  return (
    <div className="investor-timeline">
      {next ? (
        <div className="investor-timeline__next">
          <span>{next.due_date < today ? "תשלום שמועדו עבר וטרם הושלם" : "התשלום הבא"}</span>
          <strong>{formatMoney(next.investor_amount, true)}</strong>
          <em>
            {formatCalendarMonth(next.due_date)} · {formatDate(next.due_date)}
          </em>
        </div>
      ) : (
        <div className="investor-timeline__next">
          <span>{awaiting.length ? "אין תשלומים נוספים השנה" : "אין תשלומים פתוחים השנה"}</span>
          <em>{awaiting.length ? "נותר רק לאשר את מה שנשלח אליך (למעלה)." : "כל התשלומים של השנה הזו כבר התקבלו או שאין תשלומים מתוכננים."}</em>
        </div>
      )}

      {later.length ? (
        <details>
          <summary>
            עוד {later.length} תשלומים צפויים השנה · {formatMoney(later.reduce((s, p) => s + (p.investor_amount || 0), 0))}
          </summary>
          <ul>
            {later.map((p) => (
              <li key={p.id}>
                <span>
                  {formatCalendarMonth(p.due_date)}
                  <small>{formatDate(p.due_date)}</small>
                </span>
                <strong>{formatMoney(p.investor_amount, true)}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {paid.length ? (
        <details>
          <summary>
            <span className="investor-timeline__check">✓</span> {paid.length} תשלומים התקבלו השנה · {formatMoney(paidTotal)}
          </summary>
          <ul>
            {[...paid].reverse().map((p) => (
              <li key={p.id}>
                <span>
                  {formatCalendarMonth(p.due_date)}
                  <small>
                    {formatDate(p.due_date)}
                    {p.confirmed_on_behalf ? " · אושר על ידי המנהל בשמך" : ""}
                  </small>
                </span>
                <strong>{formatMoney(p.investor_amount, true)}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
