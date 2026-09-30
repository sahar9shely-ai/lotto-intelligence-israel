import type { Quote } from "../types/investments";

export type MonthRow = {
  month: number;
  profit: number;
  savings: number;
  cumulative: number;
  cumulativeSavings: number;
  compounded?: boolean;
};

export function buildMonthSchedule(quote: Quote): MonthRow[] {
  const planType = quote.plan_type || "monthly";
  const cashMonthly = quote.monthly_investor_payout || 0;
  const savingsRate = Number(quote.savings_rate_percent || 0);
  const rows: MonthRow[] = [];
  let cumulative = 0;
  let cumulativeSavings = 0;

  for (let month = 1; month <= quote.duration_months; month += 1) {
    cumulative = Math.round((cumulative + cashMonthly) * 100) / 100;
    let savings = 0;
    let compounded = false;
    if (planType !== "monthly" && savingsRate > 0) {
      savings = Math.round(quote.principal * (savingsRate / 100) * 100) / 100;
      cumulativeSavings = Math.round((cumulativeSavings + savings) * 100) / 100;
    }
    rows.push({
      month,
      profit: cashMonthly,
      savings,
      cumulative,
      cumulativeSavings,
      compounded,
    });
  }
  return rows;
}
