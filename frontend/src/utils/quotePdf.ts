import type { Quote } from "../types/investments";
import { formatMoney, formatPercent } from "./format";
import { PDF_BASE_STYLES, renderHtmlToPdf } from "./pdfDocument";
import { buildMonthSchedule } from "./quoteSchedule";

export type { MonthRow } from "./quoteSchedule";
export { buildMonthSchedule } from "./quoteSchedule";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildQuoteDocumentHtml(quote: Quote): string {
  const rows = buildMonthSchedule(quote);
  const totalProfit = quote.total_investor_payout;
  const endBalance = Math.round((quote.principal + totalProfit) * 100) / 100;
  const created = new Date().toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const name = escapeHtml(quote.prospect_name);

  const tableRows = rows
    .map(
      (r, i) => `
      <tr class="${i % 2 === 0 ? "even" : "odd"}">
        <td class="muted">חודש ${r.month}</td>
        <td class="col-num">${formatMoney(r.profit, true)}</td>
        <td class="col-num">${formatMoney(r.cumulative, true)}</td>
      </tr>`,
    )
    .join("");

  return `
  <div class="pdf-sheet" dir="rtl" lang="he">
    <header class="pdf-header">
      <div class="pdf-brand">
        <span class="pdf-brand__mark">תזרים</span>
        <span class="pdf-brand__tag">הצעת השקעה</span>
      </div>
      <div class="pdf-meta">
        <span>${created}</span>
        <span class="pdf-badge">טיוטה</span>
      </div>
    </header>

    <section class="pdf-hero">
      <h1>${name}</h1>
      <p class="pdf-hero__sub">
        קרן ${formatMoney(quote.principal)} · ${formatPercent(quote.monthly_rate_percent)} לחודש · ${quote.duration_months} חודשים
      </p>
    </section>

    <section class="pdf-kpis">
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">רווח חודשי</span>
        <strong class="pdf-kpi__value">${formatMoney(quote.monthly_investor_payout, true)}</strong>
      </div>
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">סה״כ רווח בסיום המסלול</span>
        <strong class="pdf-kpi__value">${formatMoney(totalProfit)}</strong>
      </div>
      <div class="pdf-kpi pdf-kpi--accent">
        <span class="pdf-kpi__label">קרן + רווח בסיום</span>
        <strong class="pdf-kpi__value">${formatMoney(endBalance)}</strong>
      </div>
    </section>

    <section class="pdf-table-wrap">
      <div class="pdf-section-title">
        <h2>מפרט חודשי</h2>
        <p>רווח קבוע בכל חודש לאורך המסלול</p>
      </div>
      <table class="pdf-table">
        <thead>
          <tr>
            <th>חודש</th>
            <th>רווח לחודש</th>
            <th>רווח מצטבר</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </section>

    <section class="pdf-totals">
      <div class="pdf-totals__row">
        <span>סה״כ רווח בסוף ${quote.duration_months} חודשים</span>
        <strong>${formatMoney(totalProfit)}</strong>
      </div>
      <div class="pdf-totals__row pdf-totals__row--final">
        <span>קרן + רווח בסיום</span>
        <strong>${formatMoney(endBalance)}</strong>
      </div>
    </section>

    <footer class="pdf-footer">
      <p>מסמך הצעה מתזרים · מיועד להצגה למשקיע · אינו כולל עמלת ניהול</p>
    </footer>
  </div>`;
}

/** Download a professional A4 PDF for the investor-facing quote. */
export async function downloadQuotePdf(quote: Quote): Promise<void> {
  const safeName = quote.prospect_name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "quote";
  await renderHtmlToPdf(
    buildQuoteDocumentHtml(quote),
    PDF_BASE_STYLES,
    `הצעת-תזרים-${safeName}.pdf`,
  );
}

/** @deprecated use downloadQuotePdf */
export async function openQuotePdf(quote: Quote): Promise<void> {
  return downloadQuotePdf(quote);
}
