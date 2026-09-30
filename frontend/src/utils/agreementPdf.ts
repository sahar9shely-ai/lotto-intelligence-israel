import type { PlanAgreement } from "../types/investments";
import { formatDate, formatMoney } from "./format";
import { planTypeLabel } from "./planTypes";
import { PDF_BASE_STYLES, renderHtmlPagesToPdfBlob } from "./pdfDocument";

export const agreementLabels: Record<string, string> = {
  principal: "קרן", savings: "חיסכון שנותר", transfer_total: "סכום להעברה ליתרה זמינה",
  paid_cash: "מזומן ששולם בפועל", unpaid_cash: "חוב מזומן שטרם שולם", start_date: "תאריך התחלה מוצע",
  end_date: "תום התקופה לפי התאריך המוצע", duration_months: "משך בחודשים", plan_id: "מספר מסלול",
  available_balance: "יתרה זמינה קיימת", additional_funds: "תוספת כסף חדש",
  monthly_rate_percent: "אחוז מזומן חודשי למשקיע", savings_rate_percent: "אחוז חיסכון חודשי למשקיע",
  monthly_cash: "מזומן חודשי למשקיע", monthly_savings: "חיסכון חודשי למשקיע",
  plan_type: "סוג המסלול", planned_savings_total: "חיסכון מוסכם לכל התקופה", closed_on: "תאריך סגירה",
};
export function agreementValue(key: string, value: string | number): string {
  if (key.endsWith("_date") || key === "closed_on") return formatDate(String(value));
  if (key === "plan_type") return planTypeLabel(String(value));
  if (key.endsWith("percent")) return `${value}%`;
  if (key === "plan_id" || key === "duration_months") return String(value);
  return formatMoney(Number(value));
}
export function agreementLabel(key: string, kind: PlanAgreement['kind'], executed = false): string {
  if (key === 'start_date' && (kind === 'close' || executed)) return 'תאריך התחלה בפועל';
  if (key === 'end_date' && (kind === 'close' || executed)) return 'תום התקופה המוסכמת';
  return agreementLabels[key] || key;
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
export async function agreementPdfFile(row: PlanAgreement): Promise<File> {
  const s = row.snapshot;
  const html = `<article class="pdf-sheet" dir="rtl" lang="he"><header class="pdf-header"><h1>תזרים · ${escape(s.title)}</h1><p>מסמך ${row.id} · ${row.status === "signed" ? "חתום" : "ממתין לחתימה"}</p></header>
    <p>בין ${escape(s.manager_name)} לבין ${escape(s.investor_name)}</p>
    <p>בקשה מראש: ${formatDate(s.notice_requested_on)} · הפקת מסמך: ${formatDate(row.created_at)}</p>
    <table class="pdf-table"><tbody>${Object.entries(s.terms).map(([k,v])=>`<tr><td>${escape(agreementLabel(k,row.kind))}</td><td>${escape(agreementValue(k,v))}</td></tr>`).join("")}</tbody></table>
    <footer class="pdf-footer">מסמך ${row.id} · עמוד 1 מתוך 2 · התנאים והחתימה בעמוד הבא</footer></article>`;
  const termsPage = `<article class="pdf-sheet" dir="rtl" lang="he"><header class="pdf-header"><h1>${escape(s.title)} · התנאים והאישור</h1><p>מסמך ${row.id} · ${escape(s.investor_name)}</p></header>
    <h2>התנאים המוסכמים</h2><ol>${s.clauses.map(c=>`<li>${escape(c)}</li>`).join("")}</ol>
    <h2>אישור וחתימת המשקיע</h2>${row.signature_png ? `<img alt="חתימת משקיע" style="max-width:240px;height:90px;object-fit:contain" src="${escape(row.signature_png)}"/>` : "<p>טרם נחתם</p>"}
    <p>${escape(row.signed_name || "")} · ${row.signed_at ? formatDate(row.signed_at) : ""}</p>
    ${row.execution_details ? `<h2>רישום ביצוע לפי ההסכם</h2><table class="pdf-table"><tbody>${Object.entries(row.execution_details).map(([k,v])=>`<tr><td>${escape(agreementLabel(k,row.kind,true))}</td><td>${escape(agreementValue(k,v))}</td></tr>`).join("")}</tbody></table>` : ""}
    <p style="font-size:10px;overflow-wrap:anywhere">גרסת מסמך: ${row.document_hash}</p>
    <footer class="pdf-footer">עמוד 2 מתוך 2 · תיעוד אישור אלקטרוני במערכת תזרים. רישום יתרה אינו אישור לקבלת כסף בפועל.</footer></article>`;
  const blob = await renderHtmlPagesToPdfBlob([html, termsPage], `${PDF_BASE_STYLES} li{margin:8px 0;line-height:1.65} h2{font-size:18px} ol{padding-right:22px}`);
  return new File([blob], `תזרים-הסכם-${row.id}-${row.status === "signed" ? "חתום" : "טיוטה"}.pdf`, {type:"application/pdf"});
}
