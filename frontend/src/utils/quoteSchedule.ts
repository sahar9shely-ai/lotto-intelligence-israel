import type { Quote } from "../types/investments";

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
