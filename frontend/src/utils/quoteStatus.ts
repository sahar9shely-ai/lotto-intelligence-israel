export type QuoteLifecycleStatus = "pending" | "approved" | "converted" | "rejected";

export type QuoteViewTab = "pipeline" | "completed" | "rejected";

/** In progress: waiting or approved, money not yet transferred. */
export const PIPELINE_QUOTE_STATUSES: QuoteLifecycleStatus[] = ["pending", "approved"];

/** Done: investor created and track opened. */
export const COMPLETED_QUOTE_STATUSES: QuoteLifecycleStatus[] = ["converted"];

export const REJECTED_QUOTE_STATUSES: QuoteLifecycleStatus[] = ["rejected"];

/** @deprecated use PIPELINE_QUOTE_STATUSES */
export const OPEN_QUOTE_STATUSES: QuoteLifecycleStatus[] = [
  "pending",
  "approved",
  "converted",
];

/** @deprecated use REJECTED_QUOTE_STATUSES */
export const CLOSED_QUOTE_STATUSES: QuoteLifecycleStatus[] = ["rejected"];

/** Map legacy DB values to the current lifecycle. */
export function normalizeQuoteStatus(status: string): QuoteLifecycleStatus | string {
  if (status === "draft" || status === "sent") return "pending";
  if (status === "archived") return "rejected";
  return status;
}

export function quoteViewTabForStatus(status: string): QuoteViewTab {
  const normalized = normalizeQuoteStatus(status);
  if (normalized === "converted") return "completed";
  if (normalized === "rejected") return "rejected";
  return "pipeline";
}

export function quotePipelineStepIndex(status: string): number {
  const normalized = normalizeQuoteStatus(status);
  if (normalized === "pending") return 0;
  if (normalized === "approved") return 1;
  if (normalized === "converted") return 2;
  return 0;
}

export function isPipelineQuote(status: string): boolean {
  return PIPELINE_QUOTE_STATUSES.includes(normalizeQuoteStatus(status) as QuoteLifecycleStatus);
}

export function isCompletedQuote(status: string): boolean {
  return COMPLETED_QUOTE_STATUSES.includes(normalizeQuoteStatus(status) as QuoteLifecycleStatus);
}

export function isRejectedQuote(status: string): boolean {
  return REJECTED_QUOTE_STATUSES.includes(normalizeQuoteStatus(status) as QuoteLifecycleStatus);
}

/** @deprecated */
export function isOpenQuote(status: string): boolean {
  return isPipelineQuote(status) || isCompletedQuote(status);
}

/** @deprecated */
export function isClosedQuote(status: string): boolean {
  return isRejectedQuote(status);
}

export function quoteStatusLabel(status: string): string {
  const normalized = normalizeQuoteStatus(status);
  const map: Record<QuoteLifecycleStatus, string> = {
    pending: "ממתין לתגובה",
    approved: "אושר — ממתין להעברה",
    converted: "הושלם — מסלול פעיל",
    rejected: "לא אושר",
  };
  return map[normalized as QuoteLifecycleStatus] ?? status;
}

export function quoteMoneyPhaseLabel(status: string): string {
  const normalized = normalizeQuoteStatus(status);
  const map: Record<QuoteLifecycleStatus, string> = {
    pending: "טרם אושר — אין העברת כסף",
    approved: "אושר — להעביר כסף ולפתוח מסלול",
    converted: "הכסף הועבר והמסלול פעיל",
    rejected: "לא בוצעה השקעה",
  };
  return map[normalized as QuoteLifecycleStatus] ?? "";
}

export function canEditQuote(status: string): boolean {
  return isPipelineQuote(status);
}

export function canApproveQuote(status: string): boolean {
  return normalizeQuoteStatus(status) === "pending";
}

export function canRejectQuote(status: string): boolean {
  return isPipelineQuote(status);
}

export function canConvertQuote(status: string): boolean {
  return normalizeQuoteStatus(status) === "approved";
}

/** Login credentials go out only after money transfer + track opened. */
export function canSendQuoteAccessMessage(status: string): boolean {
  return isCompletedQuote(status);
}
