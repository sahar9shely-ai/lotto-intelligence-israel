import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AgreementContent } from "../components/AgreementPanel";
import { SignaturePad } from "../components/SignaturePad";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { AuthUser } from "../types/auth";
import type { PlanAgreement } from "../types/investments";
import { isAgreementExpired } from "../utils/agreementSigning";
import "../components/agreementWorkflow.css";

export function AuthenticatedAgreementSigningPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const agreementId = Number(id);
  if (!user) return null;
  if (!Number.isSafeInteger(agreementId) || agreementId < 1) return <div className="state state--error" role="alert">מספר ההסכם אינו תקין. <Link to="/">חזרה ללוח הבקרה</Link></div>;
  return <OwnAgreement key={`${user.id}:${user.investor_id}:${user.is_manager}:${agreementId}`} user={user} agreementId={agreementId} />;
}

function OwnAgreement({ user, agreementId }: { user: AuthUser; agreementId: number }) {
  const [row, setRow] = useState<PlanAgreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setRow(null);
    api.agreement(agreementId).then(result => {
      if (!active) return;
      if (!user.is_manager && result.investor_id !== user.investor_id) {setError("אין לך הרשאה לצפות בהסכם הזה."); return;}
      setRow(result);
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : "טעינת ההסכם נכשלה");})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [agreementId, user.investor_id, user.is_manager, revision]);

  const expired = row?.status === "pending" && isAgreementExpired(row);
  const canSign = row && !user.is_manager && row.investor_id === user.investor_id && row.status === "pending" && !expired;
  const documentsPath = row && user.is_manager ? `/documents?investor_id=${row.investor_id}` : "/documents";
  return <section className="agreement-signing agreement-signing--account" dir="rtl" aria-label="הסכם וחתימה">
    <header className="agreement-signing__header"><Link className="text-link" to="/">חזרה ללוח הבקרה</Link><h1>{user.is_manager ? "צפייה בהסכם" : "קריאת ההסכם וחתימה"}</h1>
      <p>{user.is_manager ? "החתימה זמינה בחשבון המשקיע שההסכם מיועד לו." : "קרא את ההסכם המלא, בדוק את התנאים והסכומים, וחתום בתחתית המסמך."}</p></header>
    {loading ? <p role="status">טוענים את ההסכם...</p> : null}
    {error ? <div role="alert" className="form-error"><p>{error}</p><button className="btn btn--ghost" onClick={() => setRevision(value => value + 1)}>נסה שוב</button></div> : null}
    {row && !loading ? <>
      <AgreementContent row={row} />
      {row.status === "signed" ? <div role="status" className="agreement-success"><strong>ההסכם נחתם ונשמר בתיק המסמכים{user.is_manager ? " של המשקיע" : " שלך"}.</strong><p>{row.kind === "close" ? "המסלול נסגר והסכום נזקף ליתרה הזמינה לפי ההסכם." : row.kind === "amend_dates" ? "מועדי המסלול עודכנו לפי ההסכם." : "המסלול נפתח לפי התנאים שבהסכם."}</p><Link className="btn btn--ghost" to={documentsPath}>לתיק המסמכים</Link></div> : null}
      {row.status === "cancelled" ? <p role="status" className="agreement-unavailable">הסכם זה בוטל ואינו זמין לחתימה. אפשר לבדוק במסמכים אם הוכן הסכם מעודכן.</p> : null}
      {expired ? <p role="status" className="agreement-unavailable">תוקף ההסכם לחתימה פג. יש לפנות למנהל לקבלת הסכם מעודכן.</p> : null}
      {canSign ? <AgreementSignatureForm key={row.document_hash} row={row} onSigned={setRow} onRefresh={() => setRevision(value => value + 1)} /> : null}
      <footer className="agreement-signing__footer"><Link className="text-link" to={documentsPath}>לכל המסמכים בתיק</Link></footer>
    </> : null}
  </section>;
}

function AgreementSignatureForm({ row, onSigned, onRefresh }: { row: PlanAgreement; onSigned: (row: PlanAgreement) => void; onRefresh: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [png, setPng] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const title = row.kind === "close" ? "חתימה ואישור סיום המסלול" : row.kind === "amend_dates" ? "חתימה ואישור עדכון מועדי המסלול" : "חתימה ואישור פתיחת המסלול";
  async function sign() {
    if (submitting.current || !png || !accepted || name.trim().length < 2 || !password) return;
    submitting.current = true; setBusy(true); setError("");
    try {onSigned(await api.signOwnAgreement(row.id, {password, typed_name: name.trim(), signature_png: png, accepted_terms: accepted, document_hash: row.document_hash}));}
    catch (reason) {setError(reason instanceof Error ? reason.message : "שמירת החתימה נכשלה");}
    finally {setPassword(""); setBusy(false); submitting.current = false;}
  }
  return <section className="agreement-signing__confirmation" aria-label="אישור וחתימה">
    <h2>אישור וחתימה</h2>
    <form onSubmit={event => {event.preventDefault(); void sign();}}>
      <label>שם מלא של המשקיע<input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
      <label>סיסמת החשבון שלך<input type="password" required autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /><span className="hint">הסיסמה מאמתת את החתימה ואינה נשמרת במסמך.</span></label>
      <SignaturePad onChange={setPng} disabled={busy} />
      <label className="agreement-consent"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} />אני המשקיע הנקוב בהסכם; קראתי את התנאים והסכומים, אני מאשר אותם וחותם מרצוני.</label>
      {error ? <div role="alert" className="form-error"><p>{error}</p><button type="button" className="btn btn--ghost" disabled={busy} onClick={onRefresh}>רענון ההסכם ובדיקה מחדש</button></div> : null}
      <button className="btn btn--primary" disabled={busy || !png || !accepted || name.trim().length < 2 || !password}>{busy ? "שומרים את החתימה..." : title}</button>
    </form>
  </section>;
}
