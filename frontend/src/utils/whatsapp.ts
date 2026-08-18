import type { Quote } from "../types/investments";

/** Digits only, Israeli mobiles become 9725XXXXXXXX. */
export function toWhatsAppNumber(phone?: string | null): string | null {
  const raw = (phone || "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) {
    return digits.length >= 11 && digits.length <= 15 ? digits : null;
  }
  if (digits.startsWith("0") && digits.length === 10) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `972${digits}`;
  return null;
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

/** Short, gender-neutral note. Offer numbers live in the PDF, not in the chat. */
export function buildQuoteWhatsAppMessage(quote: Quote): string {
  const name = quote.prospect_name.trim() || "שלום";
  return [`היי ${name},`, "", "הצעת ההשקעה מצורפת ב-PDF.", "אם יש שאלות — אפשר לפנות אליי."].join(
    "\n",
  );
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

export function canSharePdfFile(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  try {
    return typeof nav.canShare === "function" && nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function isShareAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Native share sheet with the PDF attached (WhatsApp appears on most phones). */
export async function shareQuotePdf(quote: Quote, file: File): Promise<boolean> {
  if (!canSharePdfFile(file) || typeof navigator.share !== "function") return false;
  await navigator.share({
    files: [file],
    text: buildQuoteWhatsAppMessage(quote),
    title: file.name,
  });
  return true;
}
