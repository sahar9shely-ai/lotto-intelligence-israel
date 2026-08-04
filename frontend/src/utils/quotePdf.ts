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

export function openQuotePdf(quote: Quote) {
  const rows = buildMonthSchedule(quote);
  const totalProfit = quote.total_investor_payout;
  const title = `הצעת סיכום — ${quote.prospect_name}`;

  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td>חודש ${r.month}</td>
        <td>${formatMoney(r.profit, true)}</td>
        <td>${formatMoney(r.cumulative, true)}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body {
      font-family: "Rubik", "Arial", sans-serif;
      color: #0e2a22;
      line-height: 1.45;
      margin: 0;
    }
    h1 { font-size: 28px; margin: 0 0 6px; }
    .sub { color: #456056; margin-bottom: 22px; }
    .summary {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 18px;
      margin-bottom: 22px;
      padding: 14px;
      border: 1px solid #d5e5db;
      border-radius: 12px;
      background: #f4faf7;
    }
    .summary div { display: flex; justify-content: space-between; gap: 12px; }
    .summary strong { font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #d7e4dd; padding: 9px 6px; text-align: right; }
    th { color: #456056; font-weight: 600; }
    .total {
      margin-top: 18px;
      padding: 14px;
      border-radius: 12px;
      background: #0e2a22;
      color: #eef7f2;
      display: flex;
      justify-content: space-between;
      font-size: 18px;
    }
    .foot { margin-top: 18px; color: #678179; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="sub">מפרט תשואה חודשית קבועה · תזרים</p>
  <section class="summary">
    <div><span>קרן</span><strong>${formatMoney(quote.principal)}</strong></div>
    <div><span>אחוז חודשי</span><strong>${formatPercent(quote.monthly_rate_percent)}</strong></div>
    <div><span>משך</span><strong>${quote.duration_months} חודשים</strong></div>
    <div><span>רווח חודשי</span><strong>${formatMoney(quote.monthly_investor_payout, true)}</strong></div>
  </section>
  <h2>מפרט חודשי</h2>
  <table>
    <thead>
      <tr>
        <th>חודש</th>
        <th>רווח לחודש</th>
        <th>סה״כ רווח מצטבר</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="total">
    <span>סה״כ רווח בסיום ${quote.duration_months} חודשים</span>
    <strong>${formatMoney(totalProfit)}</strong>
  </div>
  <p class="foot">מסמך הצעה מתזרים · נוצר להצגה למשקיע</p>
  <script>
    window.onload = () => {
      setTimeout(() => window.print(), 200);
    };
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
  if (!win) {
    throw new Error("הדפדפן חסם חלון PDF — אפשרי חלונות קופצים");
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
