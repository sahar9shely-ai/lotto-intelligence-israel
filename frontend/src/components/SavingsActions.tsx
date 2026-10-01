import { useState } from "react";
import { api } from "../services/api";
import type { Plan } from "../types/investments";
import { addMonthsISO, formatDate, formatMoney, todayISO } from "../utils/format";
import type { PlanAgreement } from "../types/investments";

export function SavingsActions({ plan, onPrepared, pendingAgreement, onOpenAgreement, canManage = false }: {
  plan: Plan; onPrepared: (row: PlanAgreement) => void; canManage?: boolean;
  pendingAgreement?: PlanAgreement; onOpenAgreement: (row: PlanAgreement) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedOn,setRequestedOn] = useState(todayISO);
  if (!canManage || plan.status !== "active") return null;
  const savings = plan.current_savings_balance ?? 0;
  const maturity = addMonthsISO(plan.start_date, plan.duration_months);
  const noticeMaturity = requestedOn ? addMonthsISO(requestedOn, 1) : "";
  const earliestClose = noticeMaturity > maturity ? noticeMaturity : maturity;
  const canPrepare = Boolean(requestedOn) && requestedOn <= todayISO() && earliestClose <= todayISO();
  async function close() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const notice=await api.createNotice(plan.investor_id,{purpose:"withdraw",requested_on:requestedOn});
      const agreement = await api.closingAgreement(plan.id,notice.id);
      setOpen(false);
      onPrepared(agreement);
    } catch (err) {
      setError(err instanceof Error ? err.message : "סגירת המסלול נכשלה");
    } finally { setBusy(false); }
  }
  return <>
    {pendingAgreement ? <button type="button" className="btn btn--small btn--ghost" onClick={() => onOpenAgreement(pendingAgreement)}>סיום ממתין לחתימה · לצפייה</button> :
    <button type="button" className="btn btn--small btn--ghost" disabled={maturity > todayISO()} title={`תום התקופה המוסכמת: ${formatDate(maturity)}`} onClick={() => setOpen(true)}>הכנת סיום מסלול</button>}
    {open ? <div className="modal" role="dialog" aria-modal="true" aria-label="סגירת מסלול">
      <button type="button" className="modal__backdrop" aria-label="ביטול סגירה" disabled={busy} onClick={() => setOpen(false)} />
      <div className="modal__sheet">
        <header className="modal__head"><h2>סגירת מסלול · {plan.investor_name}</h2></header>
        <div className="modal__body">
          <p>בתום התקופה שסוכמה, ורק לאחר חתימת המשקיע, הקרן והחיסכון שנותר יעברו לחשבון היתרה הזמינה.</p>
          <label>מועד קבלת בקשת המשקיע<input type="date" value={requestedOn} max={todayISO()} onChange={e=>setRequestedOn(e.target.value)} required/><span className="hint">יש לתעד את מועד הבקשה בפועל; נדרש חודש מראש.</span></label>
          <p className="hint">תום התקופה: {formatDate(maturity)}. {requestedOn ? `לפי מועד הבקשה ניתן להכין הסכם סיום החל מ־${formatDate(earliestClose)}.` : "בחרו את מועד קבלת הבקשה."}</p>
          <dl className="plan-opening-summary">
            <dt>קרן</dt><dd>{formatMoney(plan.principal)}</dd>
            <dt>חיסכון מחודשים מלאים</dt><dd>{formatMoney(savings)}</dd>
            <dt>סה״כ להעברה</dt><dd><strong>{formatMoney(plan.principal + savings)}</strong></dd>
          </dl>
          <p className="hint">הצבירה נעצרת ותשלומים עתידיים מבוטלים. תשלום שמועדו הגיע וטרם שולם יישאר לתשלום. תשלומים שכבר שולמו נשמרים בהיסטוריה.</p>
          <p className="hint">המסלול נשאר פעיל עד חתימה. שינוי בסכומים מחייב הכנת הסכם מעודכן.</p>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setOpen(false)}>ביטול</button>
          <button type="button" className="btn btn--primary" disabled={busy || !canPrepare} onClick={() => void close()}>{busy ? "מכין הסכם..." : "הכנת הסכם סיום לחתימה"}</button>
        </div>
      </div>
    </div> : null}
  </>;
}
