import type { Dashboard, Payment } from "../types/investments";
import { formatCalendarMonth, formatDate, formatMoney, statusLabel } from "./format";
import { PDF_BASE_STYLES, renderHtmlToPdf } from "./pdfDocument";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function monthKey(value?: string | null): string {
  return (value || "").slice(0, 7);
}

export async function downloadMonthlyReportPdf(options: {
  dashboard: Dashboard;
  payments: Payment[];
  investorName: string;
  monthDate?: Date;
}): Promise<void> {
  const { dashboard, payments, investorName } = options;
  const monthDate = options.monthDate ?? new Date();
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth() + 1;
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const monthLabel = formatCalendarMonth(`${key}-01`);
  const created = new Date().toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const monthPayments = [...payments]
    .filter((p) => monthKey(p.due_date) === key || monthKey(p.paid_at) === key)
    .sort((a, b) => (a.due_date === b.due_date ? a.id - b.id : a.due_date < b.due_date ? -1 : 1));

  const paidMonth = monthPayments.filter((p) => p.status === "paid");
  const paidMonthTotal = paidMonth.reduce((s, p) => s + p.investor_amount, 0);
  const cash = dashboard.monthly_cash_payouts ?? dashboard.monthly_investor_payouts;
  const savings = dashboard.monthly_savings_accruals ?? 0;

  const tableRows = monthPayments
    .map(
      (p, i) => `
      <tr class="${i % 2 === 0 ? "even" : "odd"}">
        <td class="muted">${formatCalendarMonth(p.due_date)}</td>
        <td class="muted">${formatDate(p.due_date)}</td>
        <td class="col-num">${formatMoney(p.investor_amount, true)}</td>
        <td><span class="pdf-status pdf-status--${
          p.status === "paid"
            ? "paid"
            : p.status === "awaiting_confirmation"
              ? "awaiting"
              : p.status === "scheduled"
                ? "scheduled"
                : "skipped"
        }">${statusLabel(p.status)}</span></td>
      </tr>`,
    )
    .join("");

  const html = `
  <div class="pdf-sheet" dir="rtl" lang="he">
    <header class="pdf-header">
      <div class="pdf-brand">
        <span class="pdf-brand__mark">תזרים</span>
        <span class="pdf-brand__tag">דוח חודשי רשמי</span>
      </div>
      <div class="pdf-meta">
        <span>${created}</span>
        <span class="pdf-badge">${escapeHtml(monthLabel)} ${year}</span>
      </div>
    </header>

    <section class="pdf-hero">
      <h1>${escapeHtml(investorName)}</h1>
      <p class="pdf-hero__sub">
        סיכום התיק לחודש ${escapeHtml(monthLabel)} ${year} · קרן, החזר והעברות
      </p>
    </section>

    <section class="pdf-kpis">
      <div class="pdf-kpi pdf-kpi--accent">
        <span class="pdf-kpi__label">הקרן</span>
        <strong class="pdf-kpi__value">${formatMoney(dashboard.total_principal)}</strong>
      </div>
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">החזר חודשי (מזומן)</span>
        <strong class="pdf-kpi__value">${formatMoney(cash)}</strong>
      </div>
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">צבירת חיסכון החודש</span>
        <strong class="pdf-kpi__value">${formatMoney(savings)}</strong>
      </div>
      <div class="pdf-kpi">
        <span class="pdf-kpi__label">שולם השנה</span>
        <strong class="pdf-kpi__value">${formatMoney(dashboard.ytd_investor_paid)}</strong>
      </div>
    </section>

    <section class="pdf-totals">
      <div class="pdf-totals__row">
        <span>יתרת חיסכון כעת</span>
        <strong>${formatMoney(dashboard.current_savings_total ?? 0)}</strong>
      </div>
      <div class="pdf-totals__row pdf-totals__row--final">
        <span>העברות שהגיעו בחודש זה</span>
        <strong>${formatMoney(paidMonthTotal)}</strong>
      </div>
    </section>

    <section class="pdf-table-wrap">
      <div class="pdf-section-title">
        <h2>פירוט העברות · ${escapeHtml(monthLabel)}</h2>
        <p>${monthPayments.length} רשומות בחודש זה</p>
      </div>
      ${
        monthPayments.length === 0
          ? `<p class="pdf-hero__sub">אין העברות רשומות לחודש זה.</p>`
          : `<table class="pdf-table">
        <thead>
          <tr>
            <th>חודש</th>
            <th>תאריך</th>
            <th>סכום</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`
      }
    </section>

    <footer class="pdf-footer">
      <p>דוח חודשי רשמי מתזרים · מיועד לתיק הפרטי · אינו כולל עמלת ניהול</p>
    </footer>
  </div>`;

  await renderHtmlToPdf(
    html,
    PDF_BASE_STYLES,
    `tazrim-monthly-${key}.pdf`,
  );
}
