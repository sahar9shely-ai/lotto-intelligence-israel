import { useState } from "react";
import { api } from "../services/api";
import type { Plan } from "../types/investments";
import { formatMoney } from "../utils/format";

export function SavingsActions({ plan, onDone, canManage = false }: {
  plan: Plan; onDone: () => void; canManage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage || plan.status !== "active") return null;
  const savings = plan.current_savings_balance ?? 0;
  async function close() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.closePlan(plan.id);
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "סגירת המסלול נכשלה");
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn btn--small btn--ghost" onClick={() => setOpen(true)}>סגירת מסלול</button>
    {open ? <div className="modal" role="dialog" aria-modal="true" aria-label="סגירת מסלול">
      <button type="button" className="modal__backdrop" aria-label="ביטול סגירה" disabled={busy} onClick={() => setOpen(false)} />
      <div className="modal__sheet">
        <header className="modal__head"><h2>סגירת מסלול · {plan.investor_name}</h2></header>
        <div className="modal__body">
          <p>הקרן והחיסכון שנותר יעברו לחשבון היתרה הזמינה.</p>
          <dl className="plan-opening-summary">
            <dt>קרן</dt><dd>{formatMoney(plan.principal)}</dd>
            <dt>חיסכון מחודשים מלאים</dt><dd>{formatMoney(savings)}</dd>
            <dt>סה״כ להעברה</dt><dd><strong>{formatMoney(plan.principal + savings)}</strong></dd>
          </dl>
          <p className="hint">הצבירה נעצרת ותשלומים עתידיים מבוטלים. תשלום שמועדו הגיע וטרם שולם יישאר לתשלום. תשלומים שכבר שולמו נשמרים בהיסטוריה.</p>
          <p className="hint">הסכום הסופי יחושב מחדש בעת האישור.</p>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setOpen(false)}>ביטול</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void close()}>{busy ? "סוגר..." : "אישור סגירה והעברה ליתרה הזמינה"}</button>
        </div>
      </div>
    </div> : null}
  </>;
}
