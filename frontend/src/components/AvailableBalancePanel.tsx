import { FormEvent, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate, formatMoney } from "../utils/format";
import { Panel } from "./Panel";

const labels: Record<string, string> = {plan_close: "סגירת מסלול", withdraw: "משיכה", deposit: "תוספת כסף", plan_funding: "פתיחת מסלול"};

export function AvailableBalancePanel({investorId, canManage, canDeposit, onChanged}: {
  investorId: number; canManage: boolean; canDeposit: boolean; onChanged: () => void;
}) {
  const {data, error, loading, reload} = useAsync(() => api.wallet(investorId), [investorId]);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [amount, setAmount] = useState("");
  const [requestedOn,setRequestedOn] = useState(new Date().toLocaleDateString("en-CA"));
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  function openAction(kind: "deposit" | "withdraw") {
    setShowDeposit(kind === "deposit"); setShowWithdrawal(kind === "withdraw");
    setAmount(""); setReceived(false); setFailure(null); setOperationKey(crypto.randomUUID());
  }
  async function deposit(e: FormEvent) {
    e.preventDefault();
    if (busy || !canDeposit || !received) return;
    setBusy(true); setFailure(null);
    try {
      await api.depositBalance(investorId, Number(amount), operationKey);
      setOperationKey(crypto.randomUUID()); setShowDeposit(false); setAmount(""); setReceived(false);
      reload(); onChanged();
    } catch (err) { setFailure(err instanceof Error ? err.message : "רישום התוספת נכשל"); }
    finally { setBusy(false); }
  }
  async function withdraw(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      await api.createNotice(investorId,{purpose:"withdraw",requested_on:requestedOn});
      await api.withdrawBalance(investorId, Number(amount), operationKey);
      setOperationKey(crypto.randomUUID()); setShowWithdrawal(false); setAmount("");
      reload(); onChanged();
    } catch (err) { setFailure(err instanceof Error ? err.message : "המשיכה נכשלה"); }
    finally { setBusy(false); }
  }
  return <Panel title="חשבון יתרה זמינה">
    {loading ? <p role="status">טוען יתרה...</p> : error || !data ? <p role="alert">{error || "לא ניתן לטעון יתרה"} <button type="button" className="btn" onClick={reload}>נסה שוב</button></p> : <>
      <div className="investor-overview investor-overview--balance"><div className="investor-overview__item">
        <span>זמין למשיכה או להשקעה</span><strong>{formatMoney(data.available_balance)}</strong>
        <em>היתרה אינה צוברת תשואה</em>
      </div></div>
      {canManage ? <div className="page-head__actions">
        {canDeposit ? <button type="button" className="btn btn--primary" disabled={busy} onClick={() => openAction("deposit")}>תוספת כסף ליתרה</button> : null}
        <button type="button" className="btn btn--ghost" disabled={data.available_balance <= 0 || busy} onClick={() => openAction("withdraw")}>משיכה</button>
      </div> : null}
      <p className="hint">לפתיחת מסלול השתמשו בכפתור ״מסלול חדש״ בראש תיק המשקיע. כל היתרה שתישאר תיכלל בקרן החדשה.</p>
      {showDeposit && canDeposit ? <form className="form" aria-label="תוספת כסף ליתרה" onSubmit={deposit}>
        <label>סכום להוספה ליתרה (₪)<input type="number" min="0.01" max={20000000 - data.available_balance} step="0.01" required value={amount} disabled={busy} onChange={e => {setAmount(e.target.value); setReceived(false); setOperationKey(crypto.randomUUID());}} /></label>
        <p className="hint">יתרה לאחר התוספת: {formatMoney(data.available_balance + Number(amount || 0))}. התוספת תישמר בהיסטוריה ותהיה זמינה למסלול הבא.</p>
        <p className="hint">זהו רישום כסף שכבר התקבל. הכסף נשאר ביתרה הזמינה ואינו צובר תשואה עד לפתיחת מסלול חתום.</p>
        <label className="closure-review-check"><input type="checkbox" required checked={received} disabled={busy} onChange={e => setReceived(e.target.checked)} /> אני מאשר שהכסף התקבל ושסכום התוספת נכון.</label>
        {failure ? <p role="alert" className="form-error">{failure}</p> : null}
        <div className="page-head__actions"><button className="btn btn--primary" disabled={busy || !received}>{busy ? "רושם תוספת..." : "אישור רישום תוספת"}</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setShowDeposit(false)}>ביטול</button></div>
      </form> : null}
      {showWithdrawal ? <form className="form" onSubmit={withdraw}>
        <label>מועד קבלת בקשת המשיכה<input type="date" required max={new Date().toLocaleDateString("en-CA")} value={requestedOn} disabled={busy} onChange={e=>setRequestedOn(e.target.value)}/><span className="hint">יש לתעד את מועד הבקשה בפועל. נדרש חודש מראש לפני משיכת הכספים.</span></label>
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
