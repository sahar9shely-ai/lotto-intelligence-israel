import type { Payment } from "../types/investments";
import { formatCalendarMonth, formatDate, formatMoney } from "../utils/format";

export function PaymentCeremonyCard({
  payments,
  busyId,
  onReceived,
  onNotYet,
}: {
  payments: Payment[];
  busyId?: number | null;
  onReceived: (id: number) => void;
  onNotYet: (id: number) => void;
}) {
  if (payments.length === 0) return null;

  return (
    <section className="payment-ceremony" aria-label="אישור העברה">
      <p className="payment-ceremony__eyebrow">אישור העברה</p>
      <ul className="payment-ceremony__list">
        {payments.map((p) => (
          <li key={p.id} className="payment-ceremony__item">
            <p className="payment-ceremony__month">{formatCalendarMonth(p.due_date)}</p>
            <p className="payment-ceremony__amount">{formatMoney(p.investor_amount, true)}</p>
            <p className="payment-ceremony__date">מועד {formatDate(p.due_date)}</p>
            <div className="payment-ceremony__actions">
              <button
                type="button"
                className="btn btn--gold"
                disabled={busyId === p.id}
                onClick={() => onReceived(p.id)}
              >
                {busyId === p.id ? "רושם..." : "קיבלתי את ההעברה"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busyId === p.id}
                onClick={() => onNotYet(p.id)}
              >
                עדיין לא הגיע
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
