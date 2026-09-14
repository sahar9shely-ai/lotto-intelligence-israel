import type { Payment } from "../types/investments";
import { formatCalendarMonth, todayISO } from "./format";
import { isAdminShellInvestor } from "./roles";

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
    if (isAdminShellInvestor({ name: payment.investor_name })) continue;
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

/** Oldest due date first — the payment the admin should handle now. */
export function primaryUrgentRow(rows: UrgentInvestorRow[]): UrgentInvestorRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.investorName.localeCompare(b.investorName, "he");
  })[0];
}

export type PaymentsFocusSearch = {
  investorId: string;
  paymentId: number | null;
  year: number | null;
  month: string | null;
  status: string | null;
};

/** Deep-link to the payments board for one investor + month/payment. */
export function paymentsFocusHref(row: {
  investorId: number;
  paymentId?: number | null;
  dueDate?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("investor_id", String(row.investorId));
  if (row.paymentId) params.set("payment_id", String(row.paymentId));
  const due = row.dueDate || "";
  if (/^\d{4}-\d{2}/.test(due)) {
    params.set("year", due.slice(0, 4));
    params.set("month", due.slice(0, 7));
  }
  return `/payments?${params.toString()}`;
}

export function parsePaymentsFocusSearch(search: URLSearchParams): PaymentsFocusSearch {
  const investorId = search.get("investor_id") || "";
  const pidRaw = search.get("payment_id");
  const paymentId = pidRaw && /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
  const monthRaw = search.get("month");
  const month = monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : null;
  const yearRaw = search.get("year");
  let year: number | null = null;
  if (yearRaw && /^\d{4}$/.test(yearRaw)) year = Number(yearRaw);
  else if (month) year = Number(month.slice(0, 4));
  const statusRaw = search.get("status");
  const status = statusRaw && statusRaw.length > 0 ? statusRaw : null;
  return { investorId, paymentId, year, month, status };
}

export function paymentsFocusSearchKey(search: URLSearchParams): string {
  return search.toString();
}

export function hasPaymentsFocus(focus: PaymentsFocusSearch): boolean {
  return Boolean(focus.investorId || focus.paymentId || focus.month);
}
