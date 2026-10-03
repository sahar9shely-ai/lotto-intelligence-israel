import type { VaultDocument } from "../types/investments";

export type DocumentPeriod = { year: string; month: string | null };

/** Keep the document's recorded calendar date, without browser timezone shifts. */
export function issuedDocumentPeriod(value?: string | null): DocumentPeriod | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return null;
  const [, year, month, day] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return { year, month };
}

export function documentPeriod(doc: Pick<VaultDocument, "kind" | "period" | "issued_at">): DocumentPeriod | null {
  if (doc.kind === "yearly") {
    return /^\d{4}$/.test(doc.period ?? "") && Number(doc.period) > 0 ? { year: doc.period!, month: null } : null;
  }
  if (doc.kind === "monthly") {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(doc.period ?? "");
    return match && Number(match[1]) > 0 ? { year: match[1], month: match[2] } : null;
  }
  return issuedDocumentPeriod(doc.issued_at);
}

export function matchesDocumentPeriod(doc: Pick<VaultDocument, "kind" | "period" | "issued_at">, year: string, month: string) {
  if (!year && !month) return true;
  const period = documentPeriod(doc);
  return Boolean(period && (!year || period.year === year) && (!month || period.month === month));
}
