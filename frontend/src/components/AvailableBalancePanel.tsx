import { FormEvent, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate, formatMoney } from "../utils/format";
import { Panel } from "./Panel";

const labels: Record<string, string> = {plan_close: "סגירת מסלול", withdraw: "משיכה", deposit: "תוספת כסף", plan_funding: "פתיחת מסלול"};

export function AvailableBalancePanel({investorId, canManage, onChanged, onNewPlan}: {
  investorId: number; canManage: boolean; onChanged: () => void; onNewPlan: () => void;
}) {
  const {data, error, loading, reload} = useAsync(() => api.wallet(investorId), [investorId]);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [amount, setAmount] = useState("");
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function withdraw(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      await api.withdrawBalance(investorId, Number(amount), operationKey);
      setOperationKey(crypto.randomUUID()); setShowWithdrawal(false); setAmount("");
      reload(); onChanged();
    } catch (err) { setFailure(err instanceof Error ? err.message : "המשיכה נכשלה"); }
    finally { setBusy(false); }
  }
  return <Panel title="חשבון יתרה זמינה">
    {loading ? <p role="status">טוען יתרה...</p> : error || !data ? <p role="alert">{error || "לא ניתן לטעון יתרה"} <button type="button" className="btn" onClick={reload}>נסה שוב</button></p> : <>
      <div className="money-ledger"><div className="money-ledger__item money-ledger__item--accent">
        <span>זמין למשיכה או להשקעה</span><strong>{formatMoney(data.available_balance)}</strong>
        <em>היתרה אינה צוברת תשואה</em>
      </div></div>
      {canManage ? <div className="page-head__actions">
        <button type="button" className="btn btn--ghost" disabled={data.available_balance <= 0 || busy} onClick={() => setShowWithdrawal(true)}>משיכה</button>
        <button type="button" className="btn btn--primary" onClick={onNewPlan}>פתיחת מסלול חדש</button>
      </div> : null}
      {showWithdrawal ? <form className="form" onSubmit={withdraw}>
        <label>סכום למשיכה (₪)<input type="number" min="0.01" max={data.available_balance} step="0.01" required value={amount} disabled={busy} onChange={e => {setAmount(e.target.value); setOperationKey(crypto.randomUUID());}} /></label>
        <p className="hint">יתרה לאחר משיכה: {formatMoney(Math.max(0, data.available_balance - Number(amount || 0)))}. כל היתרה שתישאר תשמש למסלול הבא.</p>
        <p className="hint">האישור רושם משיכה במערכת; יש לבצע את העברת הכסף בפועל בנפרד.</p>
        {failure ? <p role="alert" className="form-error">{failure}</p> : null}
        <div className="page-head__actions"><button className="btn btn--primary" disabled={busy}>{busy ? "רושם משיכה..." : "אישור רישום משיכה"}</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setShowWithdrawal(false)}>ביטול</button></div>
      </form> : null}
      {data.entries.length > 0 ? <details><summary>היסטוריית תנועות ({data.entries.length})</summary>
        <div className="table-wrap"><table><thead><tr><th>תאריך</th><th>פעולה</th><th>סכום</th><th>יתרה אחרי הפעולה</th></tr></thead><tbody>
          {data.entries.map(row => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td>{labels[row.type] || row.type}{row.plan_id ? ` · מסלול ${row.plan_id}` : ""}</td><td>{formatMoney(row.amount)}</td><td>{formatMoney(row.balance_after)}</td></tr>)}
        </tbody></table></div>
      </details> : <p className="hint">עדיין אין תנועות בחשבון.</p>}
    </>}
  </Panel>;
}
