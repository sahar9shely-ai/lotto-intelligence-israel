import type { TopupRequest } from "../types/investments";
import { formatDate, formatMoney, formatPercent } from "./format";
import { PDF_BASE_STYLES, renderHtmlToPdf } from "./pdfDocument";
import { planTypeLabel } from "./planTypes";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rateLine(req: TopupRequest): string {
  const type = req.plan_type || "monthly";
  if (type === "savings") return `${formatPercent(req.savings_rate_percent ?? 0)} לחיסכון`;
  if (type === "hybrid") {
    return `${formatPercent(req.monthly_rate_percent ?? 0)} החזר חודשי + ${formatPercent(req.savings_rate_percent ?? 0)} חיסכון`;
  }
  return `${formatPercent(req.monthly_rate_percent ?? 0)} החזר חודשי`;
}

function badgeLabel(req: TopupRequest): { text: string; cls: string } {
  if (req.both_signed || req.status === "executed" || req.status === "approved") {
    return { text: "חוזה חתום", cls: "pdf-badge pdf-badge--signed" };
  }
  if (req.manager_signed || req.investor_signed) {
    return { text: "ממתין לחתימה", cls: "pdf-badge" };
  }
  return { text: "טיוטת חוזה", cls: "pdf-badge" };
}

function signBlock(title: string, name?: string | null, at?: string | null, png?: string | null) {
  const signed = Boolean(png && name);
  return `
    <div class="pdf-sign">
      <h3>${escapeHtml(title)}</h3>
      ${
        signed
          ? `<img class="pdf-sign__img" alt="חתימה" src="${escapeHtml(png || "")}" />`
          : `<div class="pdf-sign__empty">טרם נחתם</div>`
      }
      <p class="pdf-sign__name">${escapeHtml(name || "—")}</p>
      <p class="pdf-sign__meta">${signed ? `נחתם ב־${formatDate(at)}` : "ממתין לחתימה דיגיטלית"}</p>
    </div>`;
}

function buildContractHtml(req: TopupRequest): string {
  const created = new Date().toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const number = escapeHtml(req.contract_number || `TZ-${req.id}`);
  const investor = escapeHtml(req.investor_name);
  const manager = escapeHtml(req.manager_party_name || "המנהל");
  const typeLabel = planTypeLabel(req.plan_type);
  const badge = badgeLabel(req);
  const showCash = (req.plan_type || "monthly") !== "savings";
  const showSavings = (req.plan_type || "monthly") !== "monthly";

  return `
  <div class="pdf-sheet" dir="rtl" lang="he">
    <header class="pdf-header">
      <div class="pdf-brand">
        <span class="pdf-brand__mark">תזרים</span>
        <span class="pdf-brand__tag">חוזה מסלול השקעה</span>
      </div>
      <div class="pdf-meta">
        <span>מס׳ ${number}</span>
        <span>${created}</span>
        <span class="${badge.cls}">${badge.text}</span>
      </div>
    </header>

    <section class="pdf-hero">
      <h1>הסכם מסלול</h1>
      <p class="pdf-hero__sub">
        בין ${manager} (המנהל) לבין ${investor} (המשקיע)
      </p>
    </section>

    <section class="pdf-kpis pdf-kpis--4">
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">קרן</span>
        <strong class="pdf-kpi__value">${formatMoney(req.amount)}</strong>
      </div>
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">אופן המסלול</span>
        <strong class="pdf-kpi__value">${escapeHtml(typeLabel)}</strong>
      </div>
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">אחוז צפוי</span>
        <strong class="pdf-kpi__value">${escapeHtml(rateLine(req))}</strong>
      </div>
      <div class="pdf-kpi pdf-kpi--accent">
        <span class="pdf-kpi__label">משך</span>
        <strong class="pdf-kpi__value">${req.duration_months ?? "—"} חודשים</strong>
      </div>
    </section>

    <table class="pdf-table">
      <tbody>
        <tr><td class="muted">יום התחלה</td><td class="col-num">${formatDate(req.start_date)}</td></tr>
        <tr class="even"><td class="muted">יום סיום</td><td class="col-num">${formatDate(req.end_date)}</td></tr>
        ${
          showCash
            ? `<tr><td class="muted">החזר חודשי במזומן (צפוי)</td><td class="col-num">${formatMoney(req.monthly_investor_payout || 0)}</td></tr>`
            : ""
        }
        ${
          showSavings
            ? `<tr class="even"><td class="muted">צבירת חיסכון חודשית (צפויה)</td><td class="col-num">${formatMoney(req.monthly_savings_accrual || 0)}</td></tr>`
            : ""
        }
        <tr><td class="muted">סה״כ תשואה צפויה עד הסיום</td><td class="col-num">${formatMoney(req.total_investor_payout || 0)}</td></tr>
      </tbody>
    </table>

    <section class="pdf-legal">
      <h2>תנאים מחייבים</h2>
      <ol>
        <li>אין אפשרות למשוך את הקרן עד יום סיום המסלול (${formatDate(req.end_date)}).</li>
        <li>ביטול ההשקעה אפשרי בתוך 3 ימי עסקים מיום ביצוע ההשקעה (יום השלמת שתי החתימות).</li>
        <li>לאחר תום חלון הביטול המסלול נמשך במלואו לפי התנאים שלעיל, עד יום הסיום.</li>
        <li>האחוזים המוצגים הם האחוזים שהמשקיע מקבל בפועל במסלול זה.</li>
      </ol>
    </section>

    <section class="pdf-sign-grid">
      ${signBlock("חתימת המנהל", req.manager_signed_name, req.manager_signed_at, req.manager_signature_png)}
      ${signBlock("חתימת המשקיע", req.investor_signed_name, req.investor_signed_at, req.investor_signature_png)}
    </section>

    <footer class="pdf-footer">
      <p>מסמך חוזה מתזרים · ${number} · נחתם דיגיטלית על ידי שני הצדדים כאשר מופיעות שתי החתימות</p>
    </footer>
  </div>`;
}

const CONTRACT_STYLES = `
${PDF_BASE_STYLES}
.pdf-badge--signed { background: #d8f0e4; color: #1f6b55; }
.pdf-legal { margin: 22px 0 18px; }
.pdf-legal h2 {
  margin: 0 0 8px;
  font-family: "Frank Ruhl Libre", "Times New Roman", serif;
  font-size: 20px;
}
.pdf-legal ol {
  margin: 0;
  padding: 0 18px 0 0;
  font-size: 13px;
  color: #1d3a32;
  line-height: 1.55;
}
.pdf-legal li { margin-bottom: 6px; }
.pdf-sign-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 22px;
}
.pdf-sign {
  border: 1px solid #d5e5db;
  border-radius: 12px;
  padding: 12px 14px 10px;
  min-height: 150px;
}
.pdf-sign h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #5a7369;
}
.pdf-sign__img {
  display: block;
  height: 64px;
  max-width: 100%;
  object-fit: contain;
  object-position: right center;
  margin-bottom: 8px;
}
.pdf-sign__empty {
  height: 64px;
  display: flex;
  align-items: center;
  color: #8aa197;
  font-size: 12px;
  border-bottom: 1px dashed #c9dbd1;
  margin-bottom: 8px;
}
.pdf-sign__name { margin: 0; font-weight: 700; font-size: 14px; }
.pdf-sign__meta { margin: 2px 0 0; font-size: 11px; color: #5a7369; }
`;

export async function downloadContractPdf(req: TopupRequest): Promise<void> {
  const number = (req.contract_number || `TZ-${req.id}`).replace(/[\\/:*?"<>|]+/g, "-");
  const suffix = req.both_signed || req.status === "executed" || req.status === "approved" ? "חתום" : "טיוטה";
  await renderHtmlToPdf(buildContractHtml(req), CONTRACT_STYLES, `חוזה-תזרים-${number}-${suffix}.pdf`);
}
