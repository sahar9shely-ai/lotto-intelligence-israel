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

/** Short gender-neutral note. Financial details stay in the PDF. */
export function buildQuoteWhatsAppMessage(quote: Quote): string {
  const name = quote.prospect_name.trim() || "שלום";
  return [`היי ${name},`, "", "מצורפת הצעת ההשקעה ב-PDF.", "אם יש שאלות — אפשר לפנות אליי."].join(
    "\n",
  );
}

export function whatsAppOfferUrl(quote: Quote): string | null {
  const number = toWhatsAppNumber(quote.phone);
  if (!number) return null;
  const text = encodeURIComponent(buildQuoteWhatsAppMessage(quote));
  return `https://wa.me/${number}?text=${text}`;
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

/** Share sheet with PDF attached — works on many phones (pick WhatsApp). */
export async function shareQuotePdf(quote: Quote, file: File): Promise<void> {
  if (!canSharePdfFile(file) || typeof navigator.share !== "function") {
    throw new Error("הדפדפן לא תומך בשיתוף קובץ — צרפו את ה-PDF ידנית בוואטסאפ");
  }
  await navigator.share({
    files: [file],
    text: buildQuoteWhatsAppMessage(quote),
    title: file.name,
  });
}

export async function copyQuoteWhatsAppMessage(quote: Quote): Promise<void> {
  await navigator.clipboard.writeText(buildQuoteWhatsAppMessage(quote));
}
