import type { Quote } from "../types/investments";
import { formatMoney, formatPercent } from "./format";
import { PDF_BASE_STYLES, renderHtmlToPdfBlob, savePdfBlob } from "./pdfDocument";
import { buildMonthSchedule } from "./quoteSchedule";
import { planTypeLabel } from "./planTypes";
import { canSendQuoteAccessMessage } from "./quoteStatus";

export type { MonthRow } from "./quoteSchedule";
export { buildMonthSchedule } from "./quoteSchedule";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatQuoteDate(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function accessSectionHtml(quote: Quote): string {
  if (!canSendQuoteAccessMessage(quote.status)) return "";
  const start = quote.start_date ? formatQuoteDate(quote.start_date) : "";
  if (!quote.access_username && !quote.access_password && !start) return "";
  return `
    <section class="pdf-access">
      <div class="pdf-section-title">
        <h2>כניסה למערכת תזרים</h2>
        <p>פרטי הגישה נשלחים יחד עם ההצעה — אפשר להתחבר מיד אחרי האישור</p>
      </div>
      <div class="pdf-access__grid">
        ${
          start
            ? `<div class="pdf-access__item">
          <span>תחילת מסלול</span>
          <strong>${escapeHtml(start)}</strong>
        </div>`
            : ""
        }
        ${
          quote.access_username
            ? `<div class="pdf-access__item">
          <span>שם משתמש</span>
          <strong class="ltr">${escapeHtml(quote.access_username)}</strong>
        </div>`
            : ""
        }
        ${
          quote.access_password
            ? `<div class="pdf-access__item">
          <span>סיסמה</span>
          <strong class="ltr">${escapeHtml(quote.access_password)}</strong>
        </div>`
            : ""
        }
      </div>
    </section>`;
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
  const typeLabel = planTypeLabel(quote.plan_type);
  const rateLine =
    quote.plan_type === "savings"
      ? `${formatPercent(quote.savings_rate_percent)} לחיסכון`
      : quote.plan_type === "hybrid"
        ? `${formatPercent(quote.monthly_rate_percent)} חודשי + ${formatPercent(quote.savings_rate_percent)} חיסכון`
        : `${formatPercent(quote.monthly_rate_percent)} לחודש`;

  const showCash = quote.plan_type !== "savings";
  const showSavings = quote.plan_type !== "monthly";

  const tableRows = rows
    .map(
      (r, i) => `
      <tr class="${i % 2 === 0 ? "even" : "odd"}">
        <td class="muted">חודש ${r.month}${r.compounded ? " · ריבית דריבית" : ""}</td>
        ${showCash ? `<td class="col-num">${formatMoney(r.profit, true)}</td>` : ""}
        ${showSavings ? `<td class="col-num">${formatMoney(r.savings, true)}</td>` : ""}
        <td class="col-num">${formatMoney(
          r.cumulative + (showSavings ? r.cumulativeSavings : 0),
          true,
        )}</td>
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
        ${typeLabel} · קרן ${formatMoney(quote.principal)} · ${rateLine} · ${quote.duration_months} חודשים
        ${quote.phone ? ` · טלפון ${escapeHtml(quote.phone)}` : ""}
      </p>
    </section>

    <section class="pdf-kpis">
      ${
        showCash
          ? `<div class="pdf-kpi">
        <span class="pdf-kpi__label">רווח חודשי (מזומן)</span>
        <strong class="pdf-kpi__value">${formatMoney(quote.monthly_investor_payout, true)}</strong>
      </div>`
          : ""
      }
      ${
        showSavings
          ? `<div class="pdf-kpi">
        <span class="pdf-kpi__label">יתרת חיסכון בסיום</span>
        <strong class="pdf-kpi__value">${formatMoney(quote.projected_savings_balance)}</strong>
      </div>`
          : ""
      }
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">סה״כ רווח בסיום המסלול</span>
        <strong class="pdf-kpi__value">${formatMoney(totalProfit)}</strong>
      </div>
      <div class="pdf-kpi pdf-kpi--accent">
        <span class="pdf-kpi__label">קרן + רווח בסיום</span>
        <strong class="pdf-kpi__value">${formatMoney(endBalance)}</strong>
      </div>
    </section>

    ${accessSectionHtml(quote)}

    <section class="pdf-table-wrap">
      <div class="pdf-section-title">
        <h2>מפרט חודשי</h2>
        <p>${
          quote.plan_type === "savings"
            ? "צבירה לחיסכון עם ריבית דריבית כל 12 חודשים"
            : quote.plan_type === "hybrid"
              ? "החזר חודשי במזומן + צבירה לחיסכון עם ריבית דריבית"
              : "רווח קבוע בכל חודש לאורך המסלול"
        }</p>
      </div>
      <table class="pdf-table">
        <thead>
          <tr>
            <th>חודש</th>
            ${showCash ? "<th>החזר חודשי</th>" : ""}
            ${showSavings ? "<th>לחיסכון</th>" : ""}
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

/** Safe PDF download/share name: "רויטל השקעה.pdf" */
export function quotePdfFileName(quote: Pick<Quote, "prospect_name">): string {
  const name =
    quote.prospect_name
      .normalize("NFC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "משקיע";
  return `${name} השקעה.pdf`;
}

/** Build the investor-facing quote as a PDF file (for download or WhatsApp). */
export async function quotePdfFile(quote: Quote): Promise<File> {
  const fileName = quotePdfFileName(quote);
  const blob = await renderHtmlToPdfBlob(buildQuoteDocumentHtml(quote), PDF_BASE_STYLES);
  return new File([blob], fileName, { type: "application/pdf" });
}

/** Download a professional A4 PDF for the investor-facing quote. */
export async function downloadQuotePdf(quote: Quote): Promise<void> {
  const file = await quotePdfFile(quote);
  saveQuotePdfFile(file);
}

export function saveQuotePdfFile(file: File): void {
  savePdfBlob(file, file.name);
}

/** @deprecated use downloadQuotePdf */
export async function openQuotePdf(quote: Quote): Promise<void> {
  return downloadQuotePdf(quote);
}
