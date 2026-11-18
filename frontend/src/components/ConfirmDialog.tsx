import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import "./adminCorrections.css";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Short bullet list of exactly what will (and will not) change. */
  details?: string[];
  /** Ask for a free-text reason that is saved in the activity log. */
  reason?: { label: string; required?: boolean; placeholder?: string };
};

type Pending = ConfirmOptions & {
  resolve: (value: string | null) => void;
};

function lockPageScroll() {
  const body = document.body;
  const previousOverflow = body.style.overflow;
  const previousPadding = body.style.paddingRight;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  body.classList.add("modal-open");
  body.style.overflow = "hidden";
  if (scrollbar > 0) {
    body.style.paddingRight = `${scrollbar}px`;
  }
  return () => {
    body.classList.remove("modal-open");
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPadding;
  };
}

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  /** Resolves to the typed reason ("" when none was asked), or null when cancelled. */
  const confirmWithReason = useCallback((options: ConfirmOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current?.(null);
      resolveRef.current = resolve;
      setPending({ ...options, resolve });
    });
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => confirmWithReason(options).then((value) => value !== null),
    [confirmWithReason],
  );

  const close = useCallback((value: string | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setPending(null);
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      details={pending.details}
      reason={pending.reason}
      onConfirm={(reason) => close(reason ?? "")}
      onCancel={() => close(null)}
    />
  ) : null;

  return { confirm, confirmWithReason, dialog };
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "אישור",
  // "חזרה" rather than "ביטול": many actions are themselves called "ביטול" (undo).
  cancelLabel = "חזרה",
  danger = false,
  details,
  reason,
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const reasonId = useId();
  const [reasonText, setReasonText] = useState("");
  const reasonMissing = Boolean(reason?.required) && reasonText.trim().length < 2;

  useEffect(() => lockPageScroll(), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="modal modal--confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <button type="button" className="modal__backdrop" aria-label="סגירה" onClick={onCancel} />
      <div className="modal__sheet confirm-sheet">
        <header className="modal__head">
          <div>
            <p className="contract-kicker">{danger ? "פעולה רגישה" : "אישור פעולה"}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="modal__close" aria-label="סגירה" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="modal__body">
          <p id={messageId} className="confirm-sheet__message">
            {message}
          </p>
          {details?.length ? (
            <ul className="confirm-sheet__details">
              {details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {reason ? (
            <label className="confirm-sheet__reason" htmlFor={reasonId}>
              <span>
                {reason.label}
                {reason.required ? " (חובה)" : ""}
              </span>
              <textarea
                id={reasonId}
                rows={2}
                maxLength={500}
                value={reasonText}
                placeholder={reason.placeholder}
                onChange={(e) => setReasonText(e.target.value)}
              />
              <span className="hint">הסיבה נשמרת ביומן הפעולות ומוצגת בהיסטוריה.</span>
            </label>
          ) : null}
        </div>
        <div className="modal__actions action-bar">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn--ghost btn--danger" : "btn--primary"}`}
            onClick={() => onConfirm(reasonText.trim())}
            disabled={reasonMissing}
            autoFocus={!reason}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Imperative styled confirm (drop-in for window.confirm) for code outside a hook scope. */
export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (value: boolean) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(
      <ConfirmDialog {...options} onConfirm={() => done(true)} onCancel={() => done(false)} />,
    );
  });
}
