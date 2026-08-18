const moneyFmt = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

const moneyPreciseFmt = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("he-IL", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatMoney(value: number, precise = false): string {
  return (precise ? moneyPreciseFmt : moneyFmt).format(value || 0);
}

export function formatPercent(value: number): string {
  return `${Number(value || 0).toLocaleString("he-IL", {
    maximumFractionDigits: 2,
  })}%`;
}

/** Parse ISO date safely for display (avoid UTC midnight → previous-day in Israel). */
function parseDisplayDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value.includes("T") ? value : `${value}T12:00:00`);
  }
  return new Date(value);
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  return dateFmt.format(parseDisplayDate(value));
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "פעיל",
    completed: "הסתיים",
    paused: "מושהה",
    scheduled: "מתוכנן",
    awaiting_confirmation: "ממתין לאישור",
    paid: "בוצע",
    skipped: "דולג",
    draft: "טיוטה",
    sent: "נשלח",
    converted: "הומר ללקוח",
    archived: "בארכיון",
    pending: "ממתינה",
    cancelled: "בוטלה",
    rejected: "נדחתה",
    approved: "אושרה",
    reversed: "בוטלה בחלון הביטול",
  };
  return map[status] ?? status;
}

export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** First day of the given calendar year (defaults to current year). */
export function yearStartISO(year = new Date().getFullYear()): string {
  return `${year}-01-01`;
}

/** Add N calendar months to an ISO date (YYYY-MM-DD), keeping day when possible. */
export function addMonthsISO(value: string, months: number): string {
  const d = new Date(`${value}T12:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Clamp day if month rolled (e.g. Jan 31 + 1 month).
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/** Last month of a track from start + duration (plan terms). */
export function trackEndISO(startDate: string, durationMonths: number): string {
  return addMonthsISO(startDate, Math.max(durationMonths, 1) - 1);
}

/** Hebrew calendar month name from an ISO date (e.g. ינואר). */
export function formatCalendarMonth(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", { month: "long" }).format(
    parseDisplayDate(value),
  );
}
