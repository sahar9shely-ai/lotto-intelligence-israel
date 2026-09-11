const HE_TO_LATIN: Record<string, string> = {
  א: "a",
  ב: "b",
  ג: "g",
  ד: "d",
  ה: "h",
  ו: "v",
  ז: "z",
  ח: "h",
  ט: "t",
  י: "y",
  כ: "k",
  ך: "k",
  ל: "l",
  מ: "m",
  ם: "m",
  נ: "n",
  ן: "n",
  ס: "s",
  ע: "a",
  פ: "p",
  ף: "f",
  צ: "z",
  ץ: "z",
  ק: "k",
  ר: "r",
  ש: "sh",
  ת: "t",
};

export function suggestUsername(name: string, phone?: string | null): string {
  const mapped = Array.from(name.trim().toLowerCase())
    .map((ch) => {
      if (/[a-z0-9]/.test(ch)) return ch;
      if (ch === " " || ch === "-" || ch === "_") return ".";
      return HE_TO_LATIN[ch] || "";
    })
    .join("")
    .replace(/\.+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (mapped.length >= 2) return mapped.slice(0, 64);
  const digits = (phone || "").replace(/\D/g, "").slice(-4);
  return digits ? `inv${digits}` : "investor";
}

export function suggestPassword(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `Tazrim${n}!`;
}
