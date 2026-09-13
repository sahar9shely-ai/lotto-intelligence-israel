import { useState } from "react";

export function RevealSecret({
  value,
  emptyLabel = "אין סיסמה שמורה",
  hiddenLabel = "מוסתרת — לחצו להצגה",
}: {
  value?: string | null;
  emptyLabel?: string;
  hiddenLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!value) {
    return <em className="reveal-secret reveal-secret--empty">{emptyLabel}</em>;
  }
  return (
    <span className="reveal-secret">
      {open ? <em className="ltr">{value}</em> : <em>{hiddenLabel}</em>}
      <button
        type="button"
        className="btn btn--small btn--ghost reveal-secret__btn"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "הסתר" : "הצג למנהל"}
      </button>
    </span>
  );
}
