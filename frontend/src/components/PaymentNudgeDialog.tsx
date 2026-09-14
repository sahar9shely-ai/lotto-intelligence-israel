import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { PaymentNudge } from "../types/investments";
import { formatCalendarMonth, formatMoney } from "../utils/format";
import {
  buildPaymentNudgeWhatsAppMessage,
  whatsAppPaymentNudgeUrl,
} from "../utils/whatsapp";

const DISMISS_KEY = "tazrim_payment_nudge_dismissed";

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

function signature(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

export function PaymentNudgeDialog() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const navigate = useNavigate();
  const titleId = useId();
  const { data, reload } = useAsync(() => api.paymentConfirmationNudges(), [user?.id]);
  const { data: siteStatus } = useAsync(() => api.siteStatus(), []);
  const publicUrl = siteStatus?.public_url || window.location.origin;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) || "";
    } catch {
      return "";
    }
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const items = data?.items ?? [];
  const sig = useMemo(() => signature(items.map((row) => row.id)), [items]);
  const open = items.length > 0 && dismissed !== sig;

  useEffect(() => {
    if (!open) return;
    return lockPageScroll();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sig]);

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, sig);
    } catch {
      /* ignore */
    }
    setDismissed(sig);
  }

  function sharePayload(row: PaymentNudge) {
    return {
      investorName: row.investor_name,
      phone: row.investor_phone,
      dueDate: row.due_date,
      amount: row.investor_amount,
      href: row.href,
      businessDaysWaiting: row.business_days_waiting,
    };
  }

  function openPayment(row: PaymentNudge) {
    dismiss();
    navigate(row.href);
  }

  async function copyMessage(row: PaymentNudge, ok = "ההודעה הועתקה") {
    const text = buildPaymentNudgeWhatsAppMessage(sharePayload(row), publicUrl);
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote(ok);
    } catch {
      setCopyNote("לא ניתן להעתיק — פתחו וואטסאפ ידנית");
    }
    window.setTimeout(() => setCopyNote(null), 3500);
  }

  async function confirmMine(row: PaymentNudge) {
    setBusyId(row.id);
    try {
      await api.confirmPayment(row.id);
      await reload();
    } catch (err) {
      setCopyNote(err instanceof Error ? err.message : "אישור נכשל");
      window.setTimeout(() => setCopyNote(null), 3500);
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="modal modal--confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button type="button" className="modal__backdrop" aria-label="סגירה" onClick={dismiss} />
      <div className="modal__sheet confirm-sheet nudge-sheet">
        <header className="modal__head">
          <div>
            <p className="contract-kicker">נודניק לאישור תשלום</p>
            <h2 id={titleId}>
              {items.length === 1
                ? "אישור תשלום ממתין יותר מ־3 ימי עסקים"
                : `${items.length} אישורים ממתינים יותר מ־3 ימי עסקים`}
            </h2>
          </div>
          <button type="button" className="modal__close" aria-label="סגירה" onClick={dismiss}>
            ×
          </button>
        </header>
        <div className="modal__body">
          <p className="confirm-sheet__message">
            {isManager
              ? "נשלחה בקשת אישור למשקיע ועדיין לא התקבלה. אפשר לשלוח תזכורת בוואטסאפ או לפתוח את התשלום."
              : "עברו 3 ימי עסקים מאז שנשלחה ההעברה. אפשר לאשר קבלה עכשיו."}
          </p>
          <ul className="nudge-sheet__list">
            {items.map((row) => {
              const waUrl = whatsAppPaymentNudgeUrl(sharePayload(row), publicUrl);
              return (
              <li key={row.id} className="nudge-sheet__row">
                <div>
                  <strong>{isManager ? row.investor_name : formatCalendarMonth(row.due_date)}</strong>
                  <span className="muted">
                    {isManager ? `${formatCalendarMonth(row.due_date)} · ` : ""}
                    {row.business_days_waiting} ימי עסקים · {formatMoney(row.investor_amount)}
                  </span>
                </div>
                <div className="nudge-sheet__actions">
                  {isManager ? (
                    <>
                      {waUrl ? (
                        <a
                          className="btn btn--small btn--gold"
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          שלח תזכורת בוואטסאפ
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--small btn--gold"
                          onClick={() => void copyMessage(row, "אין מספר וואטסאפ — ההודעה הועתקה")}
                        >
                          שלח תזכורת בוואטסאפ
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => void copyMessage(row)}
                      >
                        העתק הודעה
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--small btn--gold"
                      disabled={busyId === row.id}
                      onClick={() => void confirmMine(row)}
                    >
                      {busyId === row.id ? "רושם..." : "קיבלתי את ההעברה"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--small btn--admin"
                    onClick={() => openPayment(row)}
                  >
                    פתח את התשלום
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
          {copyNote ? <p className="nudge-sheet__note">{copyNote}</p> : null}
        </div>
        <div className="modal__actions action-bar">
          <button type="button" className="btn btn--ghost" onClick={dismiss}>
            אחר כך
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
