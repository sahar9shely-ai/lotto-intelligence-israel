import { renderHtmlToPdf } from "./pdfDocument";

type Brief = {
  investor_name: string;
  active_principal: number;
  monthly_cash: number;
  monthly_savings: number;
  current_savings_balance: number;
  lifetime_cash_paid: number;
  cash_rate_percent: number;
  savings_rate_percent: number;
  plans: Array<{
    plan_id: number;
    status: string;
    plan_type: string;
    principal: number;
    cash_rate_percent: number;
    savings_rate_percent: number;
    monthly_cash: number;
    monthly_savings: number;
    current_savings: number;
    months_elapsed: number;
    duration_months: number;
  }>;
};

function money(n: number) {
  return `₪${Number(n || 0).toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function downloadAssistantPdf(opts: {
  name: string;
  brief: Brief;
  transcript: Array<{ role: string; content: string }>;
}) {
  const { name, brief, transcript } = opts;
  const active = (brief.plans || []).filter((p) => p.status === "active");
  const plansHtml = active
    .map(
      (p) => `
      <tr>
        <td>#${p.plan_id} · ${p.plan_type}</td>
        <td>${money(p.principal)}</td>
        <td>${p.cash_rate_percent}%</td>
        <td>${p.savings_rate_percent}%</td>
        <td>${money(p.monthly_cash)}</td>
        <td>${money(p.monthly_savings)}</td>
        <td>${p.months_elapsed}/${p.duration_months}</td>
      </tr>`,
    )
    .join("");

  const chatHtml = transcript
    .slice(-20)
    .map(
      (m) => `
      <div class="row">
        <strong>${m.role === "user" ? "את/ה" : "עוזר אישי"}</strong>
        <p>${escapeHtml(m.content).replace(/\n/g, "<br/>")}</p>
      </div>`,
    )
    .join("");

  const html = `
    <div class="pdf-sheet">
      <header class="pdf-head">
        <div>
          <p class="eyebrow">תזרים · עוזר אישי</p>
          <h1>סיכום תיק · ${escapeHtml(name)}</h1>
          <p class="lead">מזומן וחיסכון בנפרד · ללא שינוי במערכת</p>
        </div>
      </header>
      <section class="kpis">
        <div><span>קרן פעילה</span><strong>${money(brief.active_principal)}</strong></div>
        <div><span>החזר חודשי (מזומן)</span><strong>${money(brief.monthly_cash)}</strong></div>
        <div><span>צבירת חיסכון חודשית</span><strong>${money(brief.monthly_savings)}</strong></div>
        <div><span>יתרת חיסכון</span><strong>${money(brief.current_savings_balance)}</strong></div>
        <div><span>שולם במזומן עד היום</span><strong>${money(brief.lifetime_cash_paid)}</strong></div>
      </section>
      <section>
        <h2>מסלולים פעילים</h2>
        <table>
          <thead>
            <tr>
              <th>מסלול</th><th>קרן</th><th>% מזומן</th><th>% חיסכון</th>
              <th>מזומן/ח׳</th><th>חיסכון/ח׳</th><th>התקדמות</th>
            </tr>
          </thead>
          <tbody>${plansHtml || "<tr><td colspan='7'>אין מסלול פעיל</td></tr>"}</tbody>
        </table>
      </section>
      <section>
        <h2>מתמצית השיחה</h2>
        ${chatHtml || "<p>אין הודעות</p>"}
      </section>
    </div>
  `;

  const styles = `
    .pdf-sheet { font-family: "Heebo", "Arial", sans-serif; color: #14231e; padding: 28px; direction: rtl; }
    .eyebrow { margin: 0; color: #5b6b64; font-size: 12px; }
    h1 { margin: 4px 0 0; font-size: 28px; color: #1f6b55; }
    .lead { margin: 6px 0 0; color: #5b6b64; }
    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 22px 0; }
    .kpis div { background: #f3f7f5; border-radius: 12px; padding: 12px; }
    .kpis span { display: block; font-size: 11px; color: #5b6b64; margin-bottom: 4px; }
    .kpis strong { font-size: 16px; }
    h2 { font-size: 16px; color: #1f6b55; margin: 18px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #d7e0db; padding: 8px 6px; text-align: right; }
    th { color: #5b6b64; font-weight: 600; }
    .row { margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid #e7eeea; }
    .row p { margin: 4px 0 0; white-space: pre-wrap; }
  `;

  await renderHtmlToPdf(html, styles, `tazrim-assistant-${name}.pdf`);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
