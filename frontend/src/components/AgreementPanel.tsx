import { useState } from "react";
import { Panel } from "./Panel";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { PlanAgreement } from "../types/investments";
import { agreementLabel, agreementValue, agreementPdfFile } from "../utils/agreementPdf";
import { formatDate } from "../utils/format";
import { savePdfBlob } from "../utils/pdfDocument";

export function AgreementContent({row}: {row: Pick<PlanAgreement, "snapshot" | "kind"> & Partial<Pick<PlanAgreement, "id" | "created_at" | "signed_at" | "signed_name" | "signature_png" | "execution_details">>}) {
  return <div className="agreement-document"><h2>{row.snapshot.title}{row.id ? ` · ${row.id}` : " · תצוגה מקדימה"}</h2>
    <p>בין {row.snapshot.manager_name} לבין {row.snapshot.investor_name}</p>
    <p className="hint">בקשה מראש: {formatDate(row.snapshot.notice_requested_on)}{row.created_at ? ` · הופק ${formatDate(row.created_at)}` : ""}</p>
    <dl className="plan-opening-summary">{Object.entries(row.snapshot.terms).map(([key,value])=><div key={key} style={{display:"contents"}}><dt>{agreementLabel(key,row.kind)}</dt><dd>{agreementValue(key,value)}</dd></div>)}</dl>
    <ol className="agreement-clauses">{row.snapshot.clauses.map((text,i)=><li key={i}>{text}</li>)}</ol>
    {row.signed_at ? <div className="agreement-receipt"><strong>נחתם על ידי {row.signed_name} · {formatDate(row.signed_at)}</strong><img alt="חתימת המשקיע" src={row.signature_png || ""}/></div> : <p className="hint">{row.id ? "המסמך ממתין לחתימת המשקיע. הכנתו אינה מבצעת פעולה כספית." : "תצוגה מקדימה בלבד. טרם נוצר הסכם לחתימה ולא בוצעה פעולה כספית."}</p>}
    {row.execution_details ? <><h3>רישום ביצוע לפי ההסכם</h3><dl className="plan-opening-summary">{Object.entries(row.execution_details).map(([k,v])=><div key={k} style={{display:"contents"}}><dt>{agreementLabel(k,row.kind,true)}</dt><dd>{agreementValue(k,v)}</dd></div>)}</dl></>:null}
  </div>;
}

export function AgreementShare({row, phone}: {row: PlanAgreement; phone?: string | null}) {
  const [link,setLink]=useState(row.token ? `${location.origin}/sign#${row.token}` : "");
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function prepare(){setBusy(true);setError("");try {const r=await api.agreementLink(row.id);setLink(`${location.origin}/sign#${r.token}`);}catch(e){setError(e instanceof Error?e.message:"הכנת הקישור נכשלה");}finally{setBusy(false);}}
  const digits=(phone || "").replace(/\D/g,"").replace(/^0/,"972");
  return <div className="agreement-share">
    {!link ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>void prepare()}>הפקת קישור חתימה חדש</button> : <>
      <label>קישור אישי למשקיע<input value={link} readOnly dir="ltr" onFocus={e=>e.target.select()}/></label>
      <button type="button" className="btn btn--ghost" onClick={()=>void navigator.clipboard.writeText(link).catch(()=>setError("אפשר לסמן ולהעתיק את הקישור מהשדה"))}>העתקת קישור</button>
      <a className="btn btn--primary" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${digits}?text=${encodeURIComponent(`שלום ${row.snapshot.investor_name}, מצורף ${row.snapshot.title} לעיון ולאישור בחתימה: ${link}`)}`}>הכנת הודעה בוואטסאפ</a>
    </>}
    <p className="hint">הפקת קישור חדש מבטלת את הקישור הקודם לאותו מסמך. הקישור אישי, תקף ל־14 ימים ואין להעבירו לאחר. שליחת ההודעה נעשית על ידך. בזמן תחזוקה המשקיע לא יוכל לחתום.</p>
    {error ? <p role="alert">{error}</p>:null}
  </div>;
}

export function NoticePanel({investorId}: {investorId: number}) {
  const {data: notices, error, loading, reload} = useAsync(() => api.notices(investorId), [investorId]);
  const [purpose,setPurpose] = useState("withdraw"); const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false); const [failure,setFailure] = useState("");
  return <Panel title="בקשות חודש מראש" subtitle="תיעוד בקשה למשיכה, להמשך או למסלול חדש">
    <form className="form" onSubmit={async e => {
      e.preventDefault(); if(busy)return; setBusy(true);setFailure("");
      try {const row=await api.createNotice(investorId,{purpose});setMessage(`הבקשה נשמרה. מועד מוקדם לביצוע: ${formatDate(row.eligible_on)}`);reload();}
      catch(err){setFailure(err instanceof Error?err.message:"שמירת הבקשה נכשלה");}finally{setBusy(false);}
    }}><label>מטרת הבקשה<select value={purpose} disabled={busy} onChange={e=>setPurpose(e.target.value)}><option value="withdraw">משיכת כספים בתום התקופה</option><option value="renew">המשך מסלול</option><option value="new">פתיחת מסלול חדש</option></select></label>
      <div><button className="btn btn--ghost" disabled={busy}>{busy?"שומר בקשה...":"רישום בקשה מראש"}</button></div>
      <p className="hint">רישום הבקשה אינו מבצע פעולה כספית. את הסכם הפתיחה או הסיום מכינים מתוך לשונית המסלולים.</p>
    </form>
    {message?<p role="status">{message}</p>:null}{failure||error?<p role="alert">{failure||error}<button className="btn btn--ghost btn--small" onClick={reload}>נסה שוב</button></p>:null}
    {loading?<p role="status">טוען בקשות...</p>:notices?.length?<details className="agreement-notice"><summary>בקשות שנרשמו ({notices.length})</summary>{notices.map(n=><p className="hint" key={n.id}>{n.purpose==="withdraw"?"משיכה":n.purpose==="renew"?"המשך":"מסלול חדש"} · התקבלה {formatDate(n.requested_on)} · חודש מראש עד {formatDate(n.eligible_on)}</p>)}</details>:<p className="hint">אין בקשות קודמות בתיק.</p>}
  </Panel>;
}

export function AgreementPanel({rows,loading,error,canManage,canManageClosing=false,phone,onChanged}: {
  rows:PlanAgreement[];loading:boolean;error?:string|null;canManage:boolean;canManageClosing?:boolean;phone?:string|null;onChanged:()=>void;
}) {
  const [selected,setSelected]=useState<PlanAgreement|null>(null);const [year,setYear]=useState("");
  const [planFilter,setPlanFilter]=useState("");const [status,setStatus]=useState("pending");
  const [failure,setFailure]=useState("");const [busyId,setBusyId]=useState<number|null>(null);
  const years=[...new Set(rows.map(r=>r.created_at.slice(0,4)))].sort().reverse();
  const plans=[...new Set(rows.flatMap(r=>r.plan_id?[r.plan_id]:[]))];
  const visible=rows.filter(r=>(!year||r.created_at.startsWith(year))&&(!planFilter||String(r.plan_id)===planFilter)&&(!status||r.status===status));
  return <Panel title="הסכמי מסלולים וחתימות" subtitle="הסכמי פתיחה וסיום, קישורי חתימה והיסטוריית מסמכים במקום אחד" className="agreement-panel">
    <div className="workspace-filters">
      <label>מצב ההסכם<select value={status} onChange={e=>setStatus(e.target.value)}><option value="pending">ממתינים לחתימה ({rows.filter(r=>r.status==="pending").length})</option><option value="signed">חתומים ובוצעו</option><option value="cancelled">טיוטות שבוטלו</option><option value="">כל ההסכמים</option></select></label>
      <label>שנה<select value={year} onChange={e=>setYear(e.target.value)}><option value="">כל השנים</option>{years.map(y=><option key={y}>{y}</option>)}</select></label>
      <label>מסלול<select value={planFilter} onChange={e=>setPlanFilter(e.target.value)}><option value="">כל המסלולים</option>{plans.map(p=><option key={p} value={p}>מסלול #{p}</option>)}</select></label>
    </div>
    {failure||error?<p role="alert">{failure||error}<button className="btn btn--ghost btn--small" onClick={onChanged}>נסה שוב</button></p>:null}
    {loading?<p role="status">טוען הסכמים...</p>:visible.map(row=><article key={row.id} className="agreement-history-row">
      <div><strong>{row.snapshot.title} · {row.plan_id?`מסלול #${row.plan_id}`:"מסלול שטרם הופעל"}</strong><p className="hint">{formatDate(row.created_at)} · {row.status==="signed"?"חתום ובוצע":row.status==="cancelled"?"בוטל":"ממתין לחתימה"}</p></div>
      <button className="btn btn--ghost" onClick={()=>setSelected(row)}>{row.status==="pending"?"מסמך וקישור לחתימה":"צפייה במסמך"}</button>
      {canManage&&(row.kind!=="close"||canManageClosing)&&row.status==="pending"?<button className="btn btn--ghost" disabled={busyId!==null} onClick={async()=>{
        setBusyId(row.id);setFailure("");try{await api.cancelAgreement(row.id);setSelected(null);onChanged();}catch(e){setFailure(e instanceof Error?e.message:"ביטול נכשל");}finally{setBusyId(null);}
      }}>{busyId===row.id?"מבטל...":"ביטול טיוטה"}</button>:null}
    </article>)}
    {!loading&&!visible.length&&!error?<p className="empty">{status==="pending"?"אין הסכמים הממתינים לחתימה. לצפייה בהסכמים קודמים שנו את מצב ההסכם למעלה.":"אין הסכמים התואמים לסינון."}</p>:null}
    {selected?<div className="modal" role="dialog" aria-modal="true" aria-label={`הסכם ${selected.id}`}><button className="modal__backdrop" aria-label="סגירה" onClick={()=>setSelected(null)}/><div className="modal__sheet"><header className="modal__head"><h2>הסכם {selected.id}</h2><button className="btn btn--ghost" onClick={()=>setSelected(null)}>סגירה</button></header><div className="modal__body"><AgreementContent row={selected}/>{canManage&&(selected.kind!=="close"||canManageClosing)&&selected.status==="pending"?<AgreementShare row={selected} phone={phone}/>:null}</div><div className="modal__actions"><button className="btn btn--primary" onClick={async()=>{try{const f=await agreementPdfFile(selected);savePdfBlob(f,f.name);}catch(e){setFailure(e instanceof Error?e.message:"הפקת המסמך נכשלה");}}}>הורדת PDF</button></div></div></div>:null}
  </Panel>;
}
