import type { Payment, Plan } from "../types/investments";

export function isClosedPaymentPlan(plan: Pick<Plan, "status" | "closed_on">): boolean {
  return Boolean(plan.closed_on) || plan.status === "completed";
}

export type PaymentDisplayRow =
  | { kind: "payment"; date: string; payment: Payment }
  | { kind: "closure"; date: string; plan: Plan };

/** Presentation only: paid rows and outstanding obligations are never removed. */
export function buildPaymentDisplayRows(
  payments: Payment[],
  plans: Plan[],
  options: { year?: number; investorId?: number; status?: string; showCancelled?: boolean } = {},
): PaymentDisplayRow[] {
  const closedPlans = new Map(plans.filter(isClosedPaymentPlan).map((p) => [p.id, p]));
  const inScope = (date: string, investorId: number) =>
    (options.year == null || Number(date.slice(0, 4)) === options.year)
    && (options.investorId == null || investorId === options.investorId);
  const rows: PaymentDisplayRow[] = payments
    .filter((p) => inScope(p.due_date, p.investor_id)
      && (!options.status || p.status === options.status)
      && (options.showCancelled || p.status !== "skipped" || !closedPlans.has(p.plan_id)))
    .map((payment) => ({ kind: "payment", date: payment.due_date, payment }));
  // A closure is an event, not a payment. Never infer it from contractual maturity.
  if (!options.status) {
    for (const plan of closedPlans.values()) {
      const date = plan.closed_on;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !inScope(date, plan.investor_id)) continue;
      rows.push({ kind: "closure", date, plan });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date)
    || (a.kind === b.kind ? 0 : a.kind === "payment" ? -1 : 1)
    || (a.kind === "payment" ? a.payment.id : a.plan.id)
      - (b.kind === "payment" ? b.payment.id : b.plan.id));
}
