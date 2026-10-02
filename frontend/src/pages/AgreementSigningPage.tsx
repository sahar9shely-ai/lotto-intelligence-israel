import { useEffect, useState } from "react";
import { api } from "../services/api";
import { AgreementContent } from "../components/AgreementPanel";
import { SignaturePad } from "../components/SignaturePad";
import type { PlanAgreement } from "../types/investments";
import { agreementPdfFile } from "../utils/agreementPdf";
import { savePdfBlob } from "../utils/pdfDocument";

export function AgreementSigningPage(){
  const [token]=useState(()=>location.hash.slice(1));const [row,setRow]=useState<PlanAgreement|null>(null);
  const [name,setName]=useState("");const [png,setPng]=useState("");const [accepted,setAccepted]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [password,setPassword]=useState("");
  useEffect(()=>{let active=true;api.publicAgreement(token).then(r=>{if(active)setRow(r);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"טעינת המסמך נכשלה");});return()=>{active=false;};},[token]);
  async function sign(){if(!row || busy)return;setBusy(true);setError("");try{setRow(await api.signAgreement({token,password,typed_name:name.trim(),signature_png:png,accepted_terms:accepted,document_hash:row.document_hash}));setPassword("");}catch(e){setError(e instanceof Error?e.message:"החתימה נכשלה");}finally{setBusy(false);}}
  return <main className="page agreement-signing" dir="rtl"><header><h1>תזרים · אישור הסכם</h1><p>קישור אישי למשקיע בלבד. יש לקרוא את כל התנאים לפני החתימה.</p></header>
    {error ? <p role="alert" className="form-error">{error}</p>:null}
    {!row && !error ? <p role="status">טוען הסכם...</p>:null}
    {row ? <><AgreementContent row={row}/>{row.status==="signed" ? <p role="status" className="agreement-success">ההסכם נחתם ונשמר בתיק המסמכים שלך. {row.kind==="close" ? "המסלול נסגר והסכום נזקף ליתרה הזמינה." : row.kind === "amend_dates" ? "מועדי המסלול הקיים עודכנו לפי ההסכם. לא נפתח מסלול נוסף." : "המסלול נפתח בהתאם לתנאים המוסכמים."}</p> : <form onSubmit={e=>{e.preventDefault();void sign();}}>
      <label>שם מלא של המשקיע<input required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
      <label>סיסמת החשבון שלך<input type="password" required autoComplete="current-password" maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/><span className="hint">האימות משייך את החתימה לחשבון המשקיע. הסיסמה אינה נשמרת במסמך.</span></label>
      <SignaturePad onChange={setPng} disabled={busy}/>
      <label className="agreement-consent"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={busy}/>אני המשקיע הנקוב בהסכם; קראתי את התנאים והסכומים, אני מאשר אותם וחותם מרצוני.</label>
      <button className="btn btn--primary" disabled={busy || !png || !accepted || name.trim().length<2}>{busy ? "שומר חתימה..." : row.kind==="close" ? "חתימה ואישור סיום המסלול" : row.kind === "amend_dates" ? "חתימה ואישור עדכון מועדי המסלול" : "חתימה ואישור פתיחת המסלול"}</button>
    </form>}
    <button className="btn btn--ghost" onClick={async()=>{try{const f=await agreementPdfFile(row);savePdfBlob(f,f.name);}catch(e){setError(e instanceof Error?e.message:"הפקת המסמך נכשלה");}}}>הורדת עותק PDF</button></>:null}
  </main>;
}
