import { FormEvent, useEffect, useRef, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { AvailableBalanceEntry, Investor } from "../types/investments";
import { formatDate, formatMoney } from "../utils/format";
import { isAdminShellInvestor } from "../utils/roles";
import { Panel } from "./Panel";

const labels: Record<string, string> = {plan_close: "סגירת מסלול", withdraw: "משיכה", deposit: "תוספת כסף", plan_funding: "פתיחת מסלול", transfer_in: "העברה נכנסת", transfer_out: "העברה יוצאת"};

function transferAmountCents(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function balanceCents(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function entryLabel(row: AvailableBalanceEntry): string {
  if (row.counterparty_name) {
    if (row.type === "transfer_out") return `העברה אל ${row.counterparty_name}`;
    if (row.type === "transfer_in") return `העברה מאת ${row.counterparty_name}`;
  }
  return labels[row.type] || row.type;
}

export function AvailableBalancePanel({investorId, investorName, sourceAvailableBalance, canManage, canDeposit, canTransfer, recipients, onChanged}: {
  investorId: number; investorName: string; sourceAvailableBalance?: number;
  canManage: boolean; canDeposit: boolean; canTransfer: boolean;
  recipients: Investor[]; onChanged: () => void;
}) {
  const {data, error, loading, refreshing, reload} = useAsync(() => api.wallet(investorId), [investorId, sourceAvailableBalance]);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [amount, setAmount] = useState("");
  const [requestedOn,setRequestedOn] = useState(new Date().toLocaleDateString("en-CA"));
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [confirmedTransfer, setConfirmedTransfer] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const transferOperationKey = useRef<string | null>(null);
  const transferBusy = useRef(false);
  const eligibleRecipients = canTransfer ? recipients.filter(inv => inv.id !== investorId && !isAdminShellInvestor(inv)) : [];
  const recipient = eligibleRecipients.find(inv => inv.id === Number(recipientId));
  const availableCents = balanceCents(data?.available_balance);
  const amountCents = transferAmountCents(transferAmount);
  const recipientFingerprint = recipient ? JSON.stringify([recipient.id, recipient.name, recipient.is_manager, recipient.active_principal, recipient.available_balance]) : "";
  const reviewFingerprint = JSON.stringify([investorId, investorName, availableCents, sourceAvailableBalance, recipientFingerprint, amountCents, transferNotes]);
  const validTransfer = Boolean(canManage && canTransfer && recipient && amountCents != null && availableCents != null && amountCents <= availableCents && transferNotes.length <= 500 && !loading && !refreshing && !error);
  const transferConfirmed = validTransfer && confirmedTransfer === reviewFingerprint;
  const remainingCents = validTransfer ? availableCents! - amountCents! : null;
  useEffect(() => {
    setConfirmedTransfer(null);
    transferOperationKey.current = null;
  }, [investorId, investorName, availableCents, sourceAvailableBalance, recipientFingerprint, canTransfer]);

  function resetTransferReview() {
    setConfirmedTransfer(null); transferOperationKey.current = null; setFailure(null);
  }

  function openTransfer() {
    if (busy || !canManage || !canTransfer) return;
    setShowDeposit(false); setShowWithdrawal(false); setShowTransfer(true);
    setRecipientId(""); setTransferAmount(""); setTransferNotes(""); setSuccess(null);
    resetTransferReview();
  }

  async function transfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || transferBusy.current || !validTransfer || !transferConfirmed || !recipient || amountCents == null || availableCents == null) return;
    transferBusy.current = true; setBusy(true); setFailure(null); setSuccess(null);
    const key = transferOperationKey.current ?? crypto.randomUUID();
    transferOperationKey.current = key;
    try {
      const result = await api.transferBalance(investorId, {
        recipient_investor_id: recipient.id,
        amount: amountCents / 100,
        operation_key: key,
        request_confirmed: true,
        expected_source_balance: availableCents / 100,
        ...(transferNotes.trim() ? {notes: transferNotes.trim()} : {}),
      });
      setSuccess(`${formatMoney(result.amount, true)} הועברו מהיתרה של ${investorName} ל${recipient.name}.`);
      setShowTransfer(false); setConfirmedTransfer(null); transferOperationKey.current = null;
      reload(); onChanged();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "ההעברה לא הושלמה");
    } finally {
      transferBusy.current = false; setBusy(false);
    }
  }

  function openAction(kind: "deposit" | "withdraw") {
    setShowTransfer(false); setSuccess(null);
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
        <span>זמין למשיכה או להשקעה</span><strong>{formatMoney(data.available_balance, true)}</strong>
        <em>היתרה אינה צוברת תשואה</em>
      </div></div>
      {canManage ? <div className="page-head__actions">
        {canDeposit ? <button type="button" className="btn btn--primary" disabled={busy} onClick={() => openAction("deposit")}>תוספת כסף ליתרה</button> : null}
        {canTransfer ? <button type="button" className="btn btn--ghost" disabled={busy || refreshing || data.available_balance <= 0 || !eligibleRecipients.length} onClick={openTransfer}>העברה למשקיע אחר</button> : null}
        <button type="button" className="btn btn--ghost" disabled={data.available_balance <= 0 || busy} onClick={() => openAction("withdraw")}>משיכה</button>
      </div> : null}
      {success ? <p role="status" className="wallet-transfer-success">{success}</p> : null}
      <p className="hint">לפתיחת מסלול השתמשו בכפתור ״מסלול חדש״ בראש תיק המשקיע. כל היתרה שתישאר תיכלל בקרן החדשה.</p>
      {showTransfer && canManage && canTransfer ? <form className="form wallet-transfer" aria-label="העברה למשקיע אחר" onSubmit={transfer}>
        <div className="wallet-transfer__source"><span>העברה מהיתרה הזמינה של</span><strong>{investorName}</strong><span>תיק {investorId} · זמין להעברה: {formatMoney(data.available_balance, true)}</span></div>
        <div className="form__grid">
          <label>המשקיע המקבל<select required value={recipientId} disabled={busy} onChange={e => {setRecipientId(e.target.value); resetTransferReview();}}>
            <option value="">בחר משקיע</option>
            {eligibleRecipients.map(inv => <option key={inv.id} value={inv.id}>{inv.name} · תיק {inv.id}</option>)}
          </select></label>
          <label>סכום להעברה (₪)<input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" required value={transferAmount} disabled={busy} aria-describedby={`transfer-amount-hint-${investorId}`} onChange={e => {setTransferAmount(e.target.value); resetTransferReview();}} />
            <span className="hint" id={`transfer-amount-hint-${investorId}`}>הסכום יורד מהיתרה הזמינה בלבד. אפשר להזין עד שתי ספרות אחרי הנקודה.</span>
          </label>
        </div>
        {transferAmount && amountCents == null ? <p className="form-error" role="alert">יש להזין סכום חיובי בשקלים, עם עד שתי ספרות אחרי הנקודה.</p> : amountCents != null && availableCents != null && amountCents > availableCents ? <p className="form-error" role="alert">הסכום גדול מהיתרה הזמינה.</p> : null}
        {recipientId && !recipient ? <p className="form-error" role="alert">המשקיע שנבחר אינו זמין להעברה. בחר מקבל מחדש.</p> : null}
        <label>הערה או אסמכתא (אופציונלי)<textarea value={transferNotes} maxLength={500} rows={2} disabled={busy} onChange={e => {setTransferNotes(e.target.value); resetTransferReview();}} /><span className="hint">{transferNotes.length} מתוך 500 תווים</span></label>
        <section className="wallet-transfer__review" aria-labelledby={`transfer-summary-${investorId}`}>
          <h3 id={`transfer-summary-${investorId}`}>סיכום לפני אישור</h3>
          <dl className="wallet-transfer__summary">
            <dt>מהמשקיע</dt><dd>{investorName} · תיק {investorId}</dd>
            <dt>אל המשקיע</dt><dd>{recipient ? `${recipient.name} · תיק ${recipient.id}` : "טרם נבחר"}</dd>
            <dt>סכום ההעברה</dt><dd>{amountCents == null ? "—" : formatMoney(amountCents / 100, true)}</dd>
            <dt>יתרת המקור אחרי ההעברה</dt><dd>{remainingCents == null ? "—" : formatMoney(remainingCents / 100, true)}</dd>
          </dl>
          {transferNotes.trim() ? <p className="wallet-transfer__note">הערה: {transferNotes.trim()}</p> : null}
          <label className="closure-review-check"><input type="checkbox" checked={transferConfirmed} disabled={busy || !validTransfer} required onChange={e => setConfirmedTransfer(e.target.checked ? reviewFingerprint : null)} />אני מאשר שבדקתי את הבקשה, את הסכום ואת זהות המשקיע המקבל.</label>
        </section>
        {refreshing ? <p className="hint" role="status">מרענן את היתרה. יש לאשר את הסיכום המעודכן לפני ההעברה.</p> : null}
        {failure ? <p role="alert" className="form-error">{failure}</p> : null}
        <div className="page-head__actions"><button type="submit" className="btn btn--primary" disabled={busy || !transferConfirmed}>{busy ? "מבצע העברה..." : "אישור העברה"}</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => {setShowTransfer(false); resetTransferReview();}}>ביטול</button>{failure ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => {resetTransferReview(); reload(); onChanged();}}>רענון הנתונים</button> : null}</div>
      </form> : null}
      {showDeposit && canDeposit ? <form className="form" aria-label="תוספת כסף ליתרה" onSubmit={deposit}>
        <label>סכום להוספה ליתרה (₪)<input type="number" min="0.01" max={20000000 - data.available_balance} step="0.01" required value={amount} disabled={busy} onChange={e => {setAmount(e.target.value); setReceived(false); setOperationKey(crypto.randomUUID());}} /></label>
        <p className="hint">יתרה לאחר התוספת: {formatMoney(data.available_balance + Number(amount || 0), true)}. התוספת תישמר בהיסטוריה ותהיה זמינה למסלול הבא.</p>
        <p className="hint">זהו רישום כסף שכבר התקבל. הכסף נשאר ביתרה הזמינה ואינו צובר תשואה עד לפתיחת מסלול חתום.</p>
        <label className="closure-review-check" style={{display: "flex"}}><input type="checkbox" required checked={received} disabled={busy} onChange={e => setReceived(e.target.checked)} /> אני מאשר שהכסף התקבל ושסכום התוספת נכון.</label>
        {failure ? <p role="alert" className="form-error">{failure}</p> : null}
        <div className="page-head__actions"><button className="btn btn--primary" disabled={busy || !received}>{busy ? "רושם תוספת..." : "אישור רישום תוספת"}</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setShowDeposit(false)}>ביטול</button></div>
      </form> : null}
      {showWithdrawal ? <form className="form" onSubmit={withdraw}>
        <label>מועד קבלת בקשת המשיכה<input type="date" required max={new Date().toLocaleDateString("en-CA")} value={requestedOn} disabled={busy} onChange={e=>setRequestedOn(e.target.value)}/><span className="hint">יש לתעד את מועד הבקשה בפועל. נדרש חודש מראש לפני משיכת הכספים.</span></label>
        <label>סכום למשיכה (₪)<input type="number" min="0.01" max={data.available_balance} step="0.01" required value={amount} disabled={busy} onChange={e => {setAmount(e.target.value); setOperationKey(crypto.randomUUID());}} /></label>
        <p className="hint">יתרה לאחר משיכה: {formatMoney(Math.max(0, data.available_balance - Number(amount || 0)), true)}. כל היתרה שתישאר תשמש למסלול הבא.</p>
        <p className="hint">האישור רושם משיכה במערכת; יש לבצע את העברת הכסף בפועל בנפרד.</p>
        {failure ? <p role="alert" className="form-error">{failure}</p> : null}
        <div className="page-head__actions"><button className="btn btn--primary" disabled={busy}>{busy ? "רושם משיכה..." : "אישור רישום משיכה"}</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setShowWithdrawal(false)}>ביטול</button></div>
      </form> : null}
      {data.entries.length > 0 ? <details><summary>היסטוריית תנועות ({data.entries.length})</summary>
        <div className="table-wrap"><table><thead><tr><th>תאריך</th><th>פעולה</th><th>סכום</th><th>יתרה אחרי הפעולה</th></tr></thead><tbody>
          {data.entries.map(row => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td>{entryLabel(row)}{row.plan_id ? ` · מסלול ${row.plan_id}` : ""}{canTransfer && row.notes ? <span className="wallet-transfer__history-note">{row.notes}</span> : null}</td><td>{formatMoney(row.amount, true)}</td><td>{formatMoney(row.balance_after, true)}</td></tr>)}
        </tbody></table></div>
      </details> : <p className="hint">עדיין אין תנועות בחשבון.</p>}
    </>}
  </Panel>;
}
