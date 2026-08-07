import { useEffect } from "react";

function isErrorMessage(message: string) {
  return /נכשל|שגיאה|אין חיבור|אסור|הרשאה|401|403|failed|error/i.test(message);
}

/** Fixed status toast — sits under sticky chrome, never covers card actions. */
export function Toast({
  message,
  onClear,
  ms = 4200,
}: {
  message: string | null;
  onClear: () => void;
  ms?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onClear, ms);
    return () => window.clearTimeout(id);
  }, [message, onClear, ms]);

  if (!message) return null;

  return (
    <div
      className={`toast${isErrorMessage(message) ? " toast--error" : ""}`}
      role="status"
      aria-live="polite"
    >
      <p className="toast__text">{message}</p>
      <button type="button" className="toast__close" onClick={onClear} aria-label="סגירה">
        ×
      </button>
    </div>
  );
}
