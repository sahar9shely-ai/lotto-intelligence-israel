import { addMonthsISO, formatDate, todayISO } from "../utils/format";

/** Estimate only; the server records the actual start and payment date at signing. */
export function estimateFirstPaymentDate(startDate?: string | null, today = todayISO()): string | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  try {
    return addMonthsISO(startDate < today ? today : startDate, 1);
  } catch {
    return null;
  }
}

export function FirstPaymentPreview({startDate, hasCash = true}: {startDate?: string | null; hasCash?: boolean}) {
  const firstDate = hasCash ? estimateFirstPaymentDate(startDate) : null;
  if (!firstDate) return null;
  return <div className="hint" role="status">
    <strong>תשלום מזומן ראשון צפוי: {formatDate(firstDate)}</strong>
    <p>התשלום הראשון חל חודש לאחר תחילת המסלול בפועל. אם החתימה תתבצע מאוחר יותר, מועד התשלום יעודכן בהתאם לתאריך ההתחלה בפועל.</p>
  </div>;
}
