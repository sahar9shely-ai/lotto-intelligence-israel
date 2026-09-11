import {
  normalizeQuoteStatus,
  quotePipelineStepIndex,
  type QuoteLifecycleStatus,
} from "../utils/quoteStatus";

const STEPS: { key: QuoteLifecycleStatus; label: string; hint: string }[] = [
  { key: "pending", label: "ממתין", hint: "הצעה בתהליך" },
  { key: "approved", label: "אושר", hint: "ממתין להעברת כסף" },
  { key: "converted", label: "הושלם", hint: "מסלול פעיל" },
];

type Props = {
  status: string;
  compact?: boolean;
};

export function QuotePipelineStepper({ status, compact = false }: Props) {
  const normalized = normalizeQuoteStatus(status);
  if (normalized === "rejected") {
    return (
      <div className="quote-pipeline quote-pipeline--rejected" aria-label="סטטוס: לא אושר">
        <span className="quote-pipeline__rejected">לא אושר — ההצעה נסגרה</span>
      </div>
    );
  }

  const active = quotePipelineStepIndex(status);

  return (
    <ol
      className={compact ? "quote-pipeline quote-pipeline--compact" : "quote-pipeline"}
      aria-label="תהליך ההשקעה"
    >
      {STEPS.map((step, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li
            key={step.key}
            className={
              done
                ? "quote-pipeline__step is-done"
                : current
                  ? "quote-pipeline__step is-current"
                  : "quote-pipeline__step"
            }
          >
            <span className="quote-pipeline__dot" aria-hidden />
            <div className="quote-pipeline__text">
              <strong>{step.label}</strong>
              {!compact ? <em>{step.hint}</em> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function quoteNextStepHint(status: string): string | null {
  const step = normalizeQuoteStatus(status);
  if (step === "pending") {
    return "שלחו PDF למועמד/ת. כשמאשרים — לחצו «סימון כאושר».";
  }
  if (step === "approved") {
    return "אחרי העברת הכסף בפועל — «הכנס כמשקיע חדש» לפתיחת מסלול.";
  }
  if (step === "converted") {
    return "המסלול פעיל. שלחו פרטי כניסה והמשיכו במסך משקיעים.";
  }
  return null;
}
