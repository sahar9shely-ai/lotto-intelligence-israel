import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { PlanAgreement } from "../types/investments";
import { agreementLabel, agreementValue, agreementPdfFile } from "../utils/agreementPdf";
import { formatDate } from "../utils/format";
import { savePdfBlob } from "../utils/pdfDocument";

export function AgreementContent({row}: {row: PlanAgreement}) {
  return <div className="agreement-document"><h2>{row.snapshot.title} · {row.id}</h2>
    <p>בין {row.snapshot.manager_name} לבין {row.snapshot.investor_name}</p>
    <p className="hint">בקשה מראש: {formatDate(row.snapshot.notice_requested_on)} · הופק {formatDate(row.created_at)}</p>
    <dl className="plan-opening-summary">{Object.entries(row.snapshot.terms).map(([key,value])=><div key={key} style={{display:"contents"}}><dt>{agreementLabel(key,row.kind)}</dt><dd>{agreementValue(key,value)}</dd></div>)}</dl>
    <ol className="agreement-clauses">{row.snapshot.clauses.map((text,i)=><li key={i}>{text}</li>)}</ol>
    {row.signed_at ? <div className="agreement-receipt"><strong>נחתם על ידי {row.signed_name} · {formatDate(row.signed_at)}</strong><img alt="חתימת המשקיע" src={row.signature_png || ""}/></div> : <p className="hint">המסמך ממתין לחתימת המשקיע. הכנתו אינה מבצעת פעולה כספית.</p>}
    {row.execution_details ? <><h3>רישום ביצוע לפי ההסכם</h3><dl className="plan-opening-summary">{Object.entries(row.execution_details).map(([k,v])=><div key={k} style={{display:"contents"}}><dt>{agreementLabel(k,row.kind,true)}</dt><dd>{agreementValue(k,v)}</dd></div>)}</dl></>:null}
  </div>;
}

export function AgreementShare({row, phone}: {row: PlanAgreement; phone?: string | null}) {
  const [link,setLink]=useState(row.token ? `${location.origin}/sign#${row.token}` : "");
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function prepare(){setBusy(true);setError("");try {const r=await api.agreementLink(row.id);setLink(`${location.origin}/sign#${r.token}`);}catch(e){setError(e instanceof Error?e.message:"הכנת הקישור נכשלה");}finally{setBusy(false);}}
  const digits=(phone || "").replace(/\D/g,"").replace(/^0/,"972");
  return <div className="agreement-share">
    {!link ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>void prepare()}>הכנת קישור אישי לחתימה</button> : <>
      <label>קישור אישי למשקיע<input value={link} readOnly dir="ltr" onFocus={e=>e.target.select()}/></label>
      <button type="button" className="btn btn--ghost" onClick={()=>void navigator.clipboard.writeText(link).catch(()=>setError("אפשר לסמן ולהעתיק את הקישור מהשדה"))}>העתקת קישור</button>
      <a className="btn btn--primary" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${digits}?text=${encodeURIComponent(`שלום ${row.snapshot.investor_name}, מצורף ${row.snapshot.title} לעיון ולאישור בחתימה: ${link}`)}`}>הכנת הודעה בוואטסאפ</a>
    </>}
    <p className="hint">הקישור אישי, תקף ל־14 ימים ואין להעבירו לאחר. שליחת ההודעה נעשית על ידך. בזמן תחזוקה המשקיע לא יוכל לחתום.</p>
    {error ? <p role="alert">{error}</p>:null}
  </div>;
}

export function AgreementPanel({investorId,canManage,phone,onChanged}: {investorId:number;canManage:boolean;phone?:string|null;onChanged:()=>void}) {
  const [rows,setRows]=useState<PlanAgreement[]>([]);const [error,setError]=useState("");const [selected,setSelected]=useState<PlanAgreement|null>(null);const [year,setYear]=useState("");
  const [notices,setNotices]=useState<Awaited<ReturnType<typeof api.notices>>>([]);const [purpose,setPurpose]=useState("withdraw");const [noticeMessage,setNoticeMessage]=useState("");const [noticeBusy,setNoticeBusy]=useState(false);
  async function load(){try{const [agreements,requests]=await Promise.all([api.agreements(investorId),api.notices(investorId)]);setRows(agreements);setNotices(requests);}catch(e){setError(e instanceof Error?e.message:"טעינת ההסכמים נכשלה");}}
  useEffect(()=>{void load();},[investorId]);
  const years=[...new Set(rows.map(r=>r.created_at.slice(0,4)))];
  const [planFilter,setPlanFilter]=useState("");
  const plans=[...new Set(rows.flatMap(r=>r.plan_id ? [r.plan_id] : []))];
  return <section className="panel agreement-panel"><h2>הסכמים והיסטוריית מסלולים</h2>
    <p className="hint">מסמכי פתיחה וסיום נשמרים לפי מסלול ושנת הפקה. רק חתימה מפעילה את השינוי.</p>
    <details className="agreement-notice"><summary>בקשות חודש מראש</summary><form className="form" onSubmit={async e=>{e.preventDefault();if(noticeBusy)return;setNoticeBusy(true);try{const r=await api.createNotice(investorId,{purpose});setNoticeMessage(`הבקשה נשמרה. מועד מוקדם לביצוע: ${formatDate(r.eligible_on)}`);await load();}catch(err){setError(err instanceof Error?err.message:"שמירת הבקשה נכשלה");}finally{setNoticeBusy(false);}}}><label>מטרת הבקשה<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="withdraw">משיכת כספים בתום התקופה</option><option value="renew">המשך מסלול</option><option value="new">פתיחת מסלול חדש</option></select></label><button className="btn btn--ghost" disabled={noticeBusy}>שליחת בקשה מראש</button><p className="hint">הבקשה אינה מבצעת משיכה או משנה מסלול. משיכת קרן אפשרית רק בתום התקופה המוסכמת.</p></form>{noticeMessage ? <p role="status">{noticeMessage}</p>:null}{notices.map(n=><p className="hint" key={n.id}>{n.purpose==="withdraw" ? "משיכה" : n.purpose==="renew" ? "המשך" : "מסלול חדש"} · התקבלה {formatDate(n.requested_on)} · חודש מראש עד {formatDate(n.eligible_on)}</p>)}</details>
    {years.length ? <label>שנת ההסכם<select value={year} onChange={e=>setYear(e.target.value)}><option value="">כל השנים</option>{years.map(y=><option key={y}>{y}</option>)}</select></label>:null}
    {plans.length ? <label>מסלול<select value={planFilter} onChange={e=>setPlanFilter(e.target.value)}><option value="">כל המסלולים</option>{plans.map(p=><option key={p} value={p}>מסלול {p}</option>)}</select></label>:null}
    {error ? <p role="alert">{error}</p>:null}
    {rows.filter(r=>(!year || r.created_at.startsWith(year)) && (!planFilter || String(r.plan_id)===planFilter)).map(row=><article key={row.id} className="agreement-history-row">
      <div><strong>{row.snapshot.title} · {row.plan_id ? `מסלול ${row.plan_id}` : "מסלול שטרם הופעל"}</strong><p className="hint">{formatDate(row.created_at)} · {row.status==="signed" ? "חתום ובוצע" : row.status==="cancelled" ? "בוטל" : "ממתין לחתימה"}</p></div>
      <button type="button" className="btn btn--ghost" onClick={()=>setSelected(row)}>עיון במסמך</button>
      {canManage && row.status==="pending" ? <button type="button" className="btn btn--ghost" onClick={async()=>{try{await api.cancelAgreement(row.id);setSelected(null);await load();onChanged();}catch(e){setError(e instanceof Error?e.message:"ביטול נכשל");}}}>ביטול טיוטה</button>:null}
    </article>)}
    {!rows.length ? <p className="hint">אין הסכמי פתיחה או סיום חדשים בתיק. חוזים קודמים ודוחות זמינים בכספת המסמכים.</p>:null}
    {selected ? <div className="modal" role="dialog" aria-modal="true"><button className="modal__backdrop" aria-label="סגירה" onClick={()=>setSelected(null)}/><div className="modal__sheet"><header className="modal__head"><h2>הסכם {selected.id}</h2><button className="btn btn--ghost" onClick={()=>setSelected(null)}>סגירה</button></header><div className="modal__body"><AgreementContent row={selected}/>{canManage && selected.status==="pending" ? <AgreementShare row={selected} phone={phone}/>:null}</div><div className="modal__actions"><button className="btn btn--primary" onClick={async()=>{try{const f=await agreementPdfFile(selected);savePdfBlob(f,f.name);}catch(e){setError(e instanceof Error?e.message:"הפקת המסמך נכשלה");}}}>הורדת PDF</button></div></div></div>:null}
  </section>;
}
