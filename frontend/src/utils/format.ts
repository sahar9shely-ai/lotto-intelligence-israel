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

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  return dateFmt.format(new Date(value));
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
  };
  return map[status] ?? status;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** First day of the given calendar year (defaults to current year). */
export function yearStartISO(year = new Date().getFullYear()): string {
  return `${year}-01-01`;
}

/** Hebrew calendar month name from an ISO date (e.g. ינואר). */
export function formatCalendarMonth(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", { month: "long" }).format(new Date(value));
}
