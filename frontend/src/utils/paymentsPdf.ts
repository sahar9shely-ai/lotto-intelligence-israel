import type { Payment, PaymentTotals } from "../types/investments";
import { formatCalendarMonth, formatDate, formatMoney, statusLabel } from "./format";
import { PDF_BASE_STYLES, renderHtmlToPdf } from "./pdfDocument";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type YearlyPaymentsPdfOptions = {
  year: number;
  payments: Payment[];
  isManager: boolean;
  investorFilterName?: string | null;
  lifetime?: PaymentTotals | null;
};

export async function downloadYearlyPaymentsPdf(
  options: YearlyPaymentsPdfOptions,
): Promise<void> {
  const { year, payments, isManager, investorFilterName, lifetime } = options;
  const sorted = [...payments].sort((a, b) => {
    if (a.due_date === b.due_date) return a.id - b.id;
    return a.due_date < b.due_date ? -1 : 1;
  });

  const paid = sorted.filter((p) => p.status === "paid");
  const scheduled = sorted.filter((p) => p.status === "scheduled");
  const paidInvestor = paid.reduce((s, p) => s + p.investor_amount, 0);
  const paidManager = paid.reduce((s, p) => s + p.manager_amount, 0);
  const plannedInvestor = sorted.reduce((s, p) => s + p.investor_amount, 0);

  const created = new Date().toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const scope =
    investorFilterName && investorFilterName.trim()
      ? `משקיע: ${escapeHtml(investorFilterName.trim())}`
      : isManager
        ? "כל המשקיעים"
        : "התשלומים שלי";

  const tableRows = sorted
    .map((p, i) => {
      const statusClass =
        p.status === "paid"
          ? "pdf-status--paid"
          : p.status === "scheduled"
            ? "pdf-status--scheduled"
            : "pdf-status--skipped";
      return `
      <tr class="${i % 2 === 0 ? "even" : "odd"}">
        ${isManager ? `<td>${escapeHtml(p.investor_name || "—")}</td>` : ""}
        <td class="muted">${formatCalendarMonth(p.due_date)}</td>
        <td class="muted">${formatDate(p.due_date)}</td>
        <td class="col-num">${formatMoney(p.investor_amount, true)}</td>
        ${
          isManager
            ? `<td class="col-num">${formatMoney(p.manager_amount, true)}</td>`
            : ""
        }
        <td><span class="pdf-status ${statusClass}">${statusLabel(p.status)}</span></td>
      </tr>`;
    })
    .join("");

  const lifetimeBlock = lifetime
    ? `
    <section class="pdf-totals">
      <div class="pdf-section-title">
        <h2>סיכום סה״כ</h2>
        <p>כל השנים יחד</p>
      </div>
      <div class="pdf-totals__row">
        <span>סה״כ מתוכנן למשקיעים</span>
        <strong>${formatMoney(lifetime.planned_investor)}</strong>
      </div>
      <div class="pdf-totals__row pdf-totals__row--final">
        <span>סה״כ ששולם בפועל</span>
        <strong>${formatMoney(lifetime.paid_investor)}</strong>
      </div>
      ${
        isManager
          ? `<div class="pdf-totals__row">
        <span>סה״כ עמלות שהתקבלו</span>
        <strong>${formatMoney(lifetime.paid_manager)}</strong>
      </div>`
          : ""
      }
    </section>`
    : "";

  const html = `
  <div class="pdf-sheet" dir="rtl" lang="he">
    <header class="pdf-header">
      <div class="pdf-brand">
        <span class="pdf-brand__mark">תזרים</span>
        <span class="pdf-brand__tag">דוח תשלומים שנתי</span>
      </div>
      <div class="pdf-meta">
        <span>${created}</span>
        <span class="pdf-badge">${year}</span>
      </div>
    </header>

    <section class="pdf-hero">
      <h1>שנת ${year}</h1>
      <p class="pdf-hero__sub">
        1 בינואר ${year} – 31 בדצמבר ${year} · ${scope}
      </p>
    </section>

    <section class="pdf-kpis ${isManager ? "pdf-kpis--4" : ""}">
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">${isManager ? "שולם למשקיעים" : "שולם לי"}</span>
        <strong class="pdf-kpi__value">${formatMoney(paidInvestor)}</strong>
      </div>
      ${
        isManager
          ? `<div class="pdf-kpi">
        <span class="pdf-kpi__label">עמלות שהתקבלו</span>
        <strong class="pdf-kpi__value">${formatMoney(paidManager)}</strong>
      </div>`
          : ""
      }
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">תשלומים ששולמו</span>
        <strong class="pdf-kpi__value">${paid.length}</strong>
      </div>
      <div class="pdf-kpi pdf-kpi--accent">
        <span class="pdf-kpi__label">ממתינים</span>
        <strong class="pdf-kpi__value">${scheduled.length}</strong>
      </div>
    </section>

    <section class="pdf-table-wrap">
      <div class="pdf-section-title">
        <h2>פירוט חודשי לשנה</h2>
        <p>מסודר מתחילת השנה ועד סופה · ${sorted.length} רשומות</p>
      </div>
      ${
        sorted.length === 0
          ? `<p class="pdf-hero__sub">אין רשומות לשנה זו.</p>`
          : `<table class="pdf-table">
        <thead>
          <tr>
            ${isManager ? "<th>משקיע</th>" : ""}
            <th>חודש</th>
            <th>תאריך</th>
            <th>סכום</th>
            ${isManager ? "<th>עמלה</th>" : ""}
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`
      }
    </section>

    <section class="pdf-totals">
      <div class="pdf-section-title">
        <h2>סיכום שנתי</h2>
        <p>שנת ${year}</p>
      </div>
      <div class="pdf-totals__row">
        <span>סה״כ מתוכנן למשקיעים בשנת ${year}</span>
        <strong>${formatMoney(plannedInvestor)}</strong>
      </div>
      <div class="pdf-totals__row pdf-totals__row--final">
        <span>סה״כ ששולם בפועל בשנת ${year}</span>
        <strong>${formatMoney(paidInvestor)}</strong>
      </div>
    </section>

    ${lifetimeBlock}

    <footer class="pdf-footer">
      <p>דוח שנתי מתזרים · תקופה קלנדרית מלאה (${year}-01-01 עד ${year}-12-31)</p>
    </footer>
  </div>`;

  await renderHtmlToPdf(html, PDF_BASE_STYLES, `תזרים-תשלומים-${year}.pdf`);
}
