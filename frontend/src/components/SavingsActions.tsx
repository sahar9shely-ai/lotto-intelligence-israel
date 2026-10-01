import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useAsync } from "../hooks/useAsync";
import type { Plan, PlanAgreement } from "../types/investments";
import { formatDate, todayISO } from "../utils/format";
import { AgreementContent } from "./AgreementPanel";

export function SavingsActions({plan, onPrepared, pendingAgreement, onOpenAgreement, canManage = false}: {
  plan: Plan;
  onPrepared: (row: PlanAgreement) => void;
  pendingAgreement?: PlanAgreement;
  onOpenAgreement: (row: PlanAgreement) => void;
  canManage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedOn, setRequestedOn] = useState(todayISO);
  const [purpose, setPurpose] = useState<"renew" | "withdraw">("renew");
  const [reviewed, setReviewed] = useState(false);
  const {data: preview, error: previewError, loading, refreshing, reload} = useAsync(
    () => open && requestedOn && canManage ? api.previewClosingAgreement(plan.id, requestedOn, purpose) : Promise.resolve(null),
    [open, plan.id, requestedOn, purpose, canManage],
  );
  useEffect(() => {setReviewed(false);}, [requestedOn, purpose, preview?.document_hash, open]);
  if (!canManage || plan.status !== "active") return null;
  const ready = preview && (preview.snapshot.terms.closing_purpose || "withdraw") === purpose && preview.snapshot.notice_requested_on === requestedOn && Number(preview.snapshot.terms.plan_id) === plan.id && !loading && !refreshing && !previewError;
  async function prepare() {
    if (busy || !ready || !preview?.can_prepare || !reviewed) return;
    setBusy(true); setError(null);
    try {
      const notice = await api.createNotice(plan.investor_id, {purpose, requested_on:requestedOn});
      const agreement = await api.closingAgreement(plan.id, notice.id, preview.document_hash);
      setOpen(false); onPrepared(agreement);
    } catch(err) {
      setError(err instanceof Error ? err.message : "הכנת הסכם הסיום נכשלה");
      setReviewed(false); reload();
    } finally {setBusy(false);}
  }
  return <>
    {pendingAgreement ? <button className="btn btn--small btn--ghost" onClick={() => onOpenAgreement(pendingAgreement)}>סיום ממתין לחתימה · לצפייה</button> :
      <button className="btn btn--small btn--ghost" onClick={() => setOpen(true)}>סיכום וסיום מסלול</button>}
    {open ? <div className="modal" role="dialog" aria-modal="true" aria-label="סיכום לפני סיום מסלול">
      <button className="modal__backdrop" aria-label="ביטול" disabled={busy} onClick={() => setOpen(false)}/>
      <div className="modal__sheet">
        <header className="modal__head"><div><h2>סיכום לפני סיום מסלול · {plan.investor_name}</h2><p className="hint">שלב 1 · בדיקה ואישור של האדמין</p></div></header>
        <div className="modal__body">
          <p>בדוק את הסכומים ואת כל התנאים שיוצגו למשקיע. אישורך מכין הסכם וקישור לחתימה; הסגירה והזיכוי יבוצעו רק לאחר חתימת המשקיע.</p>
          <label>מטרת סיום המסלול<select value={purpose} disabled={busy} onChange={e => {setPurpose(e.target.value as "renew" | "withdraw");setError(null);}}><option value="renew">סיום ביוזמת האדמין לצורך מסלול חדש</option><option value="withdraw">משיכה בתום התקופה לבקשת המשקיע</option></select></label>
          <label>{purpose === "renew" ? "מועד יוזמת הסיום" : "מועד קבלת בקשת המשקיע"}<input type="date" value={requestedOn} max={todayISO()} disabled={busy} required onChange={e => {setRequestedOn(e.target.value);setError(null);}}/><span className="hint">{purpose === "renew" ? "אין המתנה של חודש. לאחר חתימת המשקיע המסלול ייסגר והכסף יועבר ליתרה הזמינה." : "יש לתעד את מועד הבקשה בפועל; נדרשת הודעה חודש לפני תום המסלול."}</span></label>
          {!requestedOn ? <p role="status">בחר את מועד קבלת בקשת המשקיע להצגת הסיכום.</p> : !ready && !previewError ? <p role="status">טוען סיכום מעודכן...</p> : null}
          {previewError ? <p role="alert" className="form-error">{previewError} <button className="btn btn--ghost btn--small" onClick={reload}>נסה שוב</button></p> : null}
          {ready && preview ? <>
            <p className="hint">הסכומים נכונים ל־{formatDate(preview.calculated_on)}. אפשר להכין הסכם סיום החל מ־{formatDate(preview.eligible_on)}.</p>
            {!preview.can_prepare ? <p className="form-error" role="status">{purpose === "renew" ? "אפשר לסיים רק מסלול שכבר התחיל. הכנת ההסכם תתאפשר במועד ההתחלה." : "אפשר לעיין בסיכום כעת. הכנת הסכם למשיכה תתאפשר בתום התקופה ולאחר חודש ממועד הבקשה."}</p> : null}
            <AgreementContent row={preview}/>
            <label className="closure-review-check"><input type="checkbox" checked={reviewed} disabled={busy || !preview.can_prepare} onChange={e => setReviewed(e.target.checked)}/>בדקתי את הסיכום ואת נוסח ההסכם, ואני מאשר הכנת קישור לחתימת המשקיע.</label>
          </> : null}
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </div>
        <div className="modal__actions">
          <button className="btn btn--ghost" disabled={busy} onClick={() => setOpen(false)}>חזרה ללא שינוי</button>
          <button className="btn btn--primary" disabled={busy || !ready || !preview?.can_prepare || !reviewed} onClick={() => void prepare()}>{busy ? "מכין הסכם..." : "אישור הסיכום והכנת קישור לחתימה"}</button>
        </div>
      </div>
    </div> : null}
  </>;
}
