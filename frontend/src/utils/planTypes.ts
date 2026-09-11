export type PlanType = "monthly" | "savings" | "hybrid";

export const PLAN_TYPE_OPTIONS: { value: PlanType; label: string; hint: string }[] = [
  {
    value: "monthly",
    label: "החזר חודשי",
    hint: "כל האחוזים משולמים למשקיע בכל חודש",
  },
  {
    value: "savings",
    label: "חיסכון (ריבית דריבית)",
    hint: "האחוזים נכנסים לחיסכון ומתרכבים כל 12 חודשים",
  },
  {
    value: "hybrid",
    label: "משולב",
    hint: "חלק בהחזר חודשי וחלק נכנס לחיסכון עם ריבית דריבית",
  },
];

export function planTypeLabel(value?: string | null): string {
  const found = PLAN_TYPE_OPTIONS.find((o) => o.value === value);
  return found?.label ?? "החזר חודשי";
}

export function planTypeHint(value?: string | null): string {
  const found = PLAN_TYPE_OPTIONS.find((o) => o.value === value);
  return found?.hint ?? PLAN_TYPE_OPTIONS[0].hint;
}
