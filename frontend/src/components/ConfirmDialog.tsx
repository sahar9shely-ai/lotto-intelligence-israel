import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending({ ...options, resolve });
    });
  }, []);

  const close = useCallback((value: boolean) => {
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
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, dialog };
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <button type="button" className="modal__backdrop" aria-label="סגירה" onClick={onCancel} />
      <div className="modal__sheet confirm-sheet">
        <header className="modal__head">
          <div>
            <p className="contract-kicker">{danger ? "פעולה רגישה" : "אישור פעולה"}</p>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button type="button" className="modal__close" aria-label="סגירה" onClick={onCancel}>
            ×
          </button>
        </header>
        <p className="confirm-sheet__message">{message}</p>
        <div className="action-bar">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn--ghost btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
