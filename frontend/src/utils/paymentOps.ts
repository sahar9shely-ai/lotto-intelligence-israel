import type { Payment } from "../types/investments";
import { formatCalendarMonth, todayISO } from "./format";

export type UrgentInvestorRow = {
  investorId: number;
  investorName: string;
  amount: number;
  status: string;
  dueDate: string;
  paymentId?: number;
};

export type UrgentPaymentOps = {
  today: string;
  currentMonthKey: string;
  currentMonthLabel: string;
  missingThisMonth: UrgentInvestorRow[];
  overdueTransfers: UrgentInvestorRow[];
  overdueMonthKeys: string[];
};

function yearMonth(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function cashAmount(payment: Payment): number {
  return Number(payment.investor_amount || 0);
}

function isOpenPayment(status: string): boolean {
  return status === "scheduled" || status === "awaiting_confirmation";
}

function mergeByInvestor(rows: UrgentInvestorRow[]): UrgentInvestorRow[] {
  const byId = new Map<number, UrgentInvestorRow>();
  for (const row of rows) {
    const prev = byId.get(row.investorId);
    if (!prev) {
      byId.set(row.investorId, { ...row });
      continue;
    }
    prev.amount += row.amount;
    if (prev.status === "awaiting_confirmation" && row.status === "scheduled") {
      prev.status = "scheduled";
      prev.paymentId = row.paymentId;
      prev.dueDate = row.dueDate;
    } else if (row.dueDate < prev.dueDate) {
      prev.dueDate = row.dueDate;
      prev.paymentId = row.paymentId ?? prev.paymentId;
    }
  }
  return [...byId.values()].sort((a, b) => a.investorName.localeCompare(b.investorName, "he"));
}

/** Unpaid cash payments this month, plus overdue monthly transfers from past months. */
export function buildUrgentPaymentOps(
  payments: Payment[],
  today = todayISO(),
  investorId?: number | null,
): UrgentPaymentOps {
  const currentMonthKey = yearMonth(today);
  const missingRows: UrgentInvestorRow[] = [];
  const overdueRows: UrgentInvestorRow[] = [];

  for (const payment of payments) {
    if (cashAmount(payment) <= 0) continue;
    if (investorId != null && payment.investor_id !== investorId) continue;
    if (!isOpenPayment(payment.status)) continue;

    const row: UrgentInvestorRow = {
      investorId: payment.investor_id,
      investorName: payment.investor_name,
      amount: cashAmount(payment),
      status: payment.status,
      dueDate: payment.due_date,
      paymentId: payment.id,
    };
    const key = yearMonth(payment.due_date);
    if (key === currentMonthKey) missingRows.push(row);
    else if (key < currentMonthKey) overdueRows.push(row);
  }

  return {
    today,
    currentMonthKey,
    currentMonthLabel: formatCalendarMonth(`${currentMonthKey}-01`),
    missingThisMonth: mergeByInvestor(missingRows),
    overdueTransfers: mergeByInvestor(overdueRows),
    overdueMonthKeys: [...new Set(overdueRows.map((row) => yearMonth(row.dueDate)))].sort(),
  };
}

export function joinHebrewList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ו${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;
}

export function overdueMonthsLabel(monthKeys: string[]): string {
  const labels = monthKeys.map((key) => formatCalendarMonth(`${key}-01`));
  if (labels.length === 0) return "";
  if (labels.length > 3) return "חודשים קודמים";
  return joinHebrewList(labels);
}
