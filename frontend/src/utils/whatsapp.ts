import type { Quote } from "../types/investments";
import { formatMoney, formatPercent } from "./format";
import { planTypeLabel } from "./planTypes";

/** Digits only, Israeli mobiles become 9725XXXXXXXX. */
export function toWhatsAppNumber(phone?: string | null): string | null {
  const raw = (phone || "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972") && digits.length >= 11) return digits;
  if (digits.startsWith("0") && digits.length >= 9) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `972${digits}`;
  return digits.length >= 9 ? digits : null;
}

export function formatPhoneDisplay(phone?: string | null): string {
  const raw = (phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  let local = digits;
  if (local.startsWith("972")) local = `0${local.slice(3)}`;
  if (local.length === 10 && local.startsWith("05")) {
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return raw;
}

function quoteRateLine(quote: Quote): string {
  if (quote.plan_type === "savings") return `${formatPercent(quote.savings_rate_percent)} לחיסכון`;
  if (quote.plan_type === "hybrid") {
    return `${formatPercent(quote.monthly_rate_percent)} חודשי + ${formatPercent(quote.savings_rate_percent)} חיסכון`;
  }
  return `${formatPercent(quote.monthly_rate_percent)} לחודש`;
}

export function buildQuoteWhatsAppMessage(quote: Quote): string {
  const lines = [
    `שלום ${quote.prospect_name},`,
    "מצורפת הצעת השקעה מתזרים:",
    "",
    `מסלול: ${planTypeLabel(quote.plan_type)}`,
    `קרן: ${formatMoney(quote.principal)}`,
    `אחוז צפוי: ${quoteRateLine(quote)}`,
    `משך: ${quote.duration_months} חודשים`,
  ];
  if (quote.plan_type !== "savings") {
    lines.push(`החזר חודשי במזומן: ${formatMoney(quote.monthly_investor_payout, true)}`);
  }
  if (quote.plan_type !== "monthly") {
    lines.push(`צבירת חיסכון חודשית: ${formatMoney(quote.monthly_savings_accrual, true)}`);
    lines.push(`יתרת חיסכון בסיום: ${formatMoney(quote.projected_savings_balance)}`);
  }
  lines.push(`סה״כ רווח בסיום: ${formatMoney(quote.total_investor_payout)}`);
  lines.push(`קרן + רווח בסיום: ${formatMoney(quote.principal + quote.total_investor_payout)}`);
  if (quote.notes) {
    lines.push("", quote.notes);
  }
  lines.push("", "נשמח לעבור יחד על הפרטים.");
  return lines.join("\n");
}

export function whatsAppOfferUrl(quote: Quote): string | null {
  const number = toWhatsAppNumber(quote.phone);
  if (!number) return null;
  const text = encodeURIComponent(buildQuoteWhatsAppMessage(quote));
  return `https://wa.me/${number}?text=${text}`;
}

export function openWhatsAppOffer(quote: Quote): boolean {
  const url = whatsAppOfferUrl(quote);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
