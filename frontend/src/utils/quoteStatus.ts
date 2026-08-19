export type QuoteLifecycleStatus = "pending" | "approved" | "converted" | "rejected";

export const OPEN_QUOTE_STATUSES: QuoteLifecycleStatus[] = [
  "pending",
  "approved",
  "converted",
];

export const CLOSED_QUOTE_STATUSES: QuoteLifecycleStatus[] = ["rejected"];

/** Map legacy DB values to the current lifecycle. */
export function normalizeQuoteStatus(status: string): QuoteLifecycleStatus | string {
  if (status === "draft" || status === "sent") return "pending";
  if (status === "archived") return "rejected";
  return status;
}

export function quoteStatusLabel(status: string): string {
  const normalized = normalizeQuoteStatus(status);
  const map: Record<QuoteLifecycleStatus, string> = {
    pending: "ממתין",
    approved: "אושר",
    converted: "בוצע העברה ופתיחת מסלול",
    rejected: "לא אושר",
  };
  return map[normalized as QuoteLifecycleStatus] ?? status;
}

export function isOpenQuote(status: string): boolean {
  return OPEN_QUOTE_STATUSES.includes(normalizeQuoteStatus(status) as QuoteLifecycleStatus);
}

export function isClosedQuote(status: string): boolean {
  return CLOSED_QUOTE_STATUSES.includes(normalizeQuoteStatus(status) as QuoteLifecycleStatus);
}

export function canEditQuote(status: string): boolean {
  const normalized = normalizeQuoteStatus(status);
  return normalized === "pending" || normalized === "approved";
}

export function canApproveQuote(status: string): boolean {
  return normalizeQuoteStatus(status) === "pending";
}

export function canRejectQuote(status: string): boolean {
  const normalized = normalizeQuoteStatus(status);
  return normalized === "pending" || normalized === "approved";
}

export function canConvertQuote(status: string): boolean {
  return normalizeQuoteStatus(status) === "approved";
}
