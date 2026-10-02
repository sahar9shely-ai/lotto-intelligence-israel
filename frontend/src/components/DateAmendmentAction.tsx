import { useEffect, useRef, useState } from "react";
import { AgreementContent } from "./AgreementPanel";
import { api } from "../services/api";
import type { DateAgreementInput, DateAgreementPreview, PlanAgreement } from "../types/investments";
import { addMonthsISO, formatDate } from "../utils/format";

export function DateAmendmentAction({mode, sourceId, sourceName, currentStart, sourceVersion, canManage, onPrepared}: {
  mode: "plan" | "pending"; sourceId: number; sourceName: string; currentStart: string;
  sourceVersion: string; canManage: boolean; onPrepared: (row: PlanAgreement) => void;
}) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(currentStart);
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<DateAgreementPreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const generation = useRef(0);
  const dateValue = useRef(currentStart);
  const noteValue = useRef("");
  useEffect(() => {generation.current++; setPreview(null); setReviewed(false);}, [sourceVersion, sourceId, mode, canManage]);
  if (!canManage) return null;
  function clearReview() {generation.current++; setPreview(null); setReviewed(false); setError("");}
  function openEditor() {clearReview(); dateValue.current = currentStart; noteValue.current = ""; setStartDate(currentStart); setNotes(""); setOpen(true);}
  function changeDate(next: string) {
    if (next === dateValue.current) return;
    dateValue.current = next; clearReview(); setStartDate(next);
  }
  function changeNotes(next: string) {
    if (next === noteValue.current) return;
    noteValue.current = next; clearReview(); setNotes(next);
  }
  let firstDate = "";
  try {if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) firstDate = addMonthsISO(startDate, 1);} catch { /* Wait for a valid date. */ }
  const valid = Boolean(firstDate) && notes.length <= 500;
  const body: DateAgreementInput = {start_date: startDate, ...(notes.trim() ? {notes: notes.trim()} : {})};
  async function loadPreview() {
    if (busyRef.current || !valid) return;
    const revision = generation.current;
    busyRef.current = true; setBusy(true); setError(""); setReviewed(false); setPreview(null);
    try {
      const result = mode === "plan" ? await api.previewDateAmendment(sourceId, body) : await api.previewAgreementReplacement(sourceId, body);
      if (revision === generation.current) setPreview(result);
    } catch (err) {if (revision === generation.current) setError(err instanceof Error ? err.message : "טעינת ההסכם נכשלה");}
    finally {busyRef.current = false; setBusy(false);}
  }
  async function prepare() {
    if (busyRef.current || !valid || !preview?.can_prepare || !reviewed) return;
    const revision = generation.current;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const payload = {...body, reviewed_document_hash: preview.document_hash};
      const result = mode === "plan" ? await api.prepareDateAmendment(sourceId, payload) : await api.prepareAgreementReplacement(sourceId, payload);
      setOpen(false);
      if (revision === generation.current) onPrepared(result);
    } catch (err) {
      if (revision === generation.current) {setError(err instanceof Error ? err.message : "הכנת ההסכם נכשלה"); setPreview(null); setReviewed(false);}
    } finally {busyRef.current = false; setBusy(false);}
  }
  return <>
    <button type="button" className="btn btn--small btn--ghost" onClick={openEditor}>תיקון תאריכים והסכם מחדש</button>
    {open ? <div className="modal" role="dialog" aria-modal="true" aria-label={`תיקון תאריכים · ${sourceName}`}>
      <button type="button" className="modal__backdrop" aria-label="סגירה" disabled={busy} onClick={() => setOpen(false)}/>
      <div className="modal__sheet">
        <header className="modal__head"><h2>תיקון מועדי המסלול · {sourceName}</h2><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setOpen(false)}>סגירה</button></header>
        <div className="modal__body form">
          <p>{mode === "plan" ? "ההסכם החדש יעדכן את מועדי המסלול הקיים רק לאחר חתימת המשקיע. לא נפתח מסלול נוסף ולא מועבר כסף." : "ההסכם החדש ישמור על הסכומים והאחוזים שבהסכם הקיים. עם הכנתו, הטיוטה הקודמת וקישור החתימה שלה יבוטלו; המסלול יופעל רק לאחר חתימה על ההסכם החדש."}</p>
          <label>תאריך התחלה מתוקן<input type="date" required value={startDate} disabled={busy} onInput={e => changeDate(e.currentTarget.value)} onChange={e => changeDate(e.target.value)}/></label>
          <dl className="plan-opening-summary"><dt>תאריך התחלה קודם</dt><dd>{formatDate(currentStart)}</dd><dt>תשלום מזומן ראשון לפי התאריך המתוקן</dt><dd>{firstDate ? formatDate(firstDate) : "בחר תאריך התחלה"}</dd></dl>
          <p className="hint">התשלום הראשון חל לאחר חודש מלא מתחילת המסלול. שינוי תאריך או הערה מחייב בדיקה ואישור מחדש.</p>
          <label>הערה להסכם (אופציונלי)<textarea value={notes} maxLength={500} disabled={busy} onInput={e => changeNotes(e.currentTarget.value)} onChange={e => changeNotes(e.target.value)}/></label>
          <button type="button" className="btn btn--ghost" disabled={busy || !valid} onClick={() => void loadPreview()}>{busy ? "טוען..." : "בדיקת הסיכום ונוסח ההסכם"}</button>
          {preview ? <>
            <AgreementContent row={preview}/>
            {!preview.can_prepare ? <p role="status" className="form-error">לא ניתן להכין את ההסכם לפי הנתונים הנוכחיים.</p> : null}
            <label className="closure-review-check"><input type="checkbox" checked={reviewed} disabled={busy || !preview.can_prepare} onChange={e => setReviewed(e.target.checked)}/>בדקתי את התאריכים ואת נוסח ההסכם, ואני מאשר הכנת קישור חדש לחתימת המשקיע.</label>
          </> : null}
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </div>
        <div className="modal__actions"><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setOpen(false)}>חזרה ללא שינוי</button><button type="button" className="btn btn--primary" disabled={busy || !valid || !preview?.can_prepare || !reviewed} onClick={() => void prepare()}>{busy ? "מכין הסכם..." : "הכנת הסכם וקישור לחתימה"}</button></div>
      </div>
    </div> : null}
  </>;
}
