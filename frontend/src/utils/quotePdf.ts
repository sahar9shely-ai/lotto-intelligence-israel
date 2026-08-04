import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { Quote } from "../types/investments";
import { formatMoney, formatPercent } from "./format";

export type MonthRow = {
  month: number;
  profit: number;
  cumulative: number;
};

export function buildMonthSchedule(quote: Quote): MonthRow[] {
  const monthly = quote.monthly_investor_payout;
  const rows: MonthRow[] = [];
  let cumulative = 0;
  for (let month = 1; month <= quote.duration_months; month += 1) {
    cumulative = Math.round((cumulative + monthly) * 100) / 100;
    rows.push({ month, profit: monthly, cumulative });
  }
  return rows;
}

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
        <td class="col-month">חודש ${r.month}</td>
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

const PDF_STYLES = `
  .pdf-root * { box-sizing: border-box; }
  .pdf-sheet {
    width: 794px;
    padding: 36px 44px 28px;
    background: #ffffff;
    color: #0e2a22;
    font-family: "Rubik", "Segoe UI", Tahoma, sans-serif;
    line-height: 1.4;
    direction: rtl;
    text-align: right;
  }
  .pdf-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    padding-bottom: 14px;
    border-bottom: 1px solid #d7e4dd;
  }
  .pdf-brand__mark {
    display: block;
    font-family: "Frank Ruhl Libre", "Times New Roman", serif;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #0e2a22;
  }
  .pdf-brand__tag {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: #5a7369;
  }
  .pdf-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    font-size: 11px;
    color: #5a7369;
  }
  .pdf-badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 999px;
    background: #f0e6d4;
    color: #8a6a2f;
    font-size: 10px;
    font-weight: 600;
  }
  .pdf-hero { margin-bottom: 18px; }
  .pdf-hero h1 {
    margin: 0 0 6px;
    font-family: "Frank Ruhl Libre", "Times New Roman", serif;
    font-size: 34px;
    font-weight: 700;
    line-height: 1.12;
    color: #0e2a22;
  }
  .pdf-hero__sub {
    margin: 0;
    font-size: 14px;
    color: #456056;
  }
  .pdf-kpis {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-bottom: 22px;
  }
  .pdf-kpi {
    padding: 12px 14px;
    border-radius: 12px;
    background: #f4faf7;
    border: 1px solid #d5e5db;
  }
  .pdf-kpi--accent {
    background: #0e2a22;
    border-color: #0e2a22;
    color: #eef7f2;
  }
  .pdf-kpi--accent .pdf-kpi__label { color: #a8c4b8; }
  .pdf-kpi__label {
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    color: #5a7369;
  }
  .pdf-kpi__value {
    display: block;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .pdf-section-title {
    margin-bottom: 10px;
  }
  .pdf-section-title h2 {
    margin: 0 0 2px;
    font-family: "Frank Ruhl Libre", "Times New Roman", serif;
    font-size: 20px;
    font-weight: 700;
  }
  .pdf-section-title p {
    margin: 0;
    font-size: 12px;
    color: #5a7369;
  }
  .pdf-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .pdf-table thead th {
    padding: 8px 10px;
    background: #eef5f1;
    color: #456056;
    font-weight: 600;
    text-align: right;
    border-bottom: 1px solid #c9dbd1;
  }
  .pdf-table td {
    padding: 7px 10px;
    border-bottom: 1px solid #e4eee8;
    text-align: right;
  }
  .pdf-table tr.even td { background: #fafcfb; }
  .pdf-table .col-month { color: #456056; font-weight: 500; }
  .pdf-table .col-num { font-variant-numeric: tabular-nums; font-weight: 600; }
  .pdf-totals {
    margin-top: 16px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #d5e5db;
  }
  .pdf-totals__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 11px 14px;
    background: #f4faf7;
    font-size: 14px;
  }
  .pdf-totals__row--final {
    background: #0e2a22;
    color: #eef7f2;
    font-size: 16px;
  }
  .pdf-footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #d7e4dd;
  }
  .pdf-footer p {
    margin: 0;
    font-size: 10px;
    color: #7a9087;
  }
`;

async function waitForFonts(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // ignore — fall back to system fonts
  }
}

function mountPdfNode(html: string): HTMLElement {
  const host = document.createElement("div");
  host.className = "pdf-root";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;pointer-events:none;opacity:1;z-index:-1;";
  const style = document.createElement("style");
  style.textContent = PDF_STYLES;
  host.appendChild(style);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  host.appendChild(wrap);
  document.body.appendChild(host);
  return host;
}

function canvasToPdf(canvas: HTMLCanvasElement, fileName: string): void {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 8;
  const marginY = 8;
  const usableWidth = pageWidth - marginX * 2;
  const usableHeight = pageHeight - marginY * 2;
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  let imgWidth = usableWidth;
  let imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Fit on one page when only slightly over (avoids a nearly-blank page 2).
  if (imgHeight <= usableHeight * 1.12) {
    if (imgHeight > usableHeight) {
      const scale = usableHeight / imgHeight;
      imgWidth *= scale;
      imgHeight = usableHeight;
    }
    const offsetX = marginX + (usableWidth - imgWidth) / 2;
    pdf.addImage(imgData, "JPEG", offsetX, marginY, imgWidth, imgHeight, undefined, "FAST");
    pdf.save(fileName);
    return;
  }

  let heightLeft = imgHeight;
  let position = marginY;
  pdf.addImage(imgData, "JPEG", marginX, position, imgWidth, imgHeight, undefined, "FAST");
  heightLeft -= usableHeight;

  while (heightLeft > 8) {
    position = marginY - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", marginX, position, imgWidth, imgHeight, undefined, "FAST");
    heightLeft -= usableHeight;
  }

  pdf.save(fileName);
}

/** Download a professional A4 PDF for the investor-facing quote. */
export async function downloadQuotePdf(quote: Quote): Promise<void> {
  await waitForFonts();
  const host = mountPdfNode(buildQuoteDocumentHtml(quote));
  const sheet = host.querySelector(".pdf-sheet") as HTMLElement | null;
  if (!sheet) {
    host.remove();
    throw new Error("לא ניתן לבנות את מסמך ה-PDF");
  }

  try {
    // Allow layout/fonts to settle before capture
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: sheet.scrollWidth,
      windowHeight: sheet.scrollHeight,
    });
    const safeName = quote.prospect_name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "quote";
    canvasToPdf(canvas, `הצעת-תזרים-${safeName}.pdf`);
  } finally {
    host.remove();
  }
}

/** @deprecated use downloadQuotePdf */
export async function openQuotePdf(quote: Quote): Promise<void> {
  return downloadQuotePdf(quote);
}
