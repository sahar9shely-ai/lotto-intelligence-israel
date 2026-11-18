import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../services/api";
import { formatCalendarMonth, formatMoney } from "../utils/format";
import {
  buildOnBehalfConfirmedMessage,
  whatsAppOnBehalfConfirmedUrl,
  type OnBehalfConfirmation,
} from "../utils/whatsapp";
import { useConfirm } from "./ConfirmDialog";
import "./adminCorrections.css";

export type OnBehalfTarget = {
  id: number;
  investor_name: string;
  due_date: string;
  investor_amount: number;
  status: string;
  phone?: string | null;
};

/**
 * Admin confirms receipt for an investor who cannot do it in the app (e.g. an
 * elderly investor who confirmed by phone), then sends them a WhatsApp message.
 */
export function useConfirmOnBehalf(onDone: (message: string) => void, onError: (message: string) => void) {
  const { confirmWithReason, dialog } = useConfirm();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sent, setSent] = useState<OnBehalfConfirmation | null>(null);
  const [copied, setCopied] = useState(false);

  async function start(row: OnBehalfTarget) {
    if (busyId !== null) return;
    const amount = formatMoney(row.investor_amount, true);
    const note = await confirmWithReason({
      title: `אישור קבלה בשם ${row.investor_name}`,
      message: `${formatCalendarMonth(row.due_date)} · ${amount}`,
      details: [
        "התשלום יסומן כ״בוצע״, בדיוק כאילו המשקיע אישר בעצמו.",
        "יירשם שהאישור ניתן על ידך בשם המשקיע — והמשקיע יראה זאת בתיק שלו.",
        "השתמשו בזה רק אחרי שהמשקיע אישר לכם שהכסף התקבל.",
        "אם נלחץ בטעות — אפשר להחזיר ל״מתוכנן״ משורת התשלום.",
      ],
      reason: { label: "איך המשקיע אישר?", required: true, placeholder: "לדוגמה: אישר בשיחת טלפון" },
      confirmLabel: "אישור בשם המשקיע",
    });
    if (note === null) return;
    setBusyId(row.id);
    try {
      await api.confirmPaymentOnBehalf(row.id, note);
      setCopied(false);
      setSent({ investorName: row.investor_name, phone: row.phone, dueDate: row.due_date, amount: row.investor_amount });
      onDone(`התשלום של ${row.investor_name} סומן כבוצע — אושר על ידך בשם המשקיע`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "אישור התשלום נכשל");
    } finally {
      setBusyId(null);
    }
  }

  const waUrl = sent ? whatsAppOnBehalfConfirmedUrl(sent) : null;
  const text = sent ? buildOnBehalfConfirmedMessage(sent) : "";
  const sentDialog = sent
    ? createPortal(
        <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label="האישור נרשם">
          <button type="button" className="modal__backdrop" aria-label="סגירה" onClick={() => setSent(null)} />
          <div className="modal__sheet confirm-sheet">
            <header className="modal__head">
              <div>
                <p className="contract-kicker">האישור נרשם</p>
                <h2>הודעה ל{sent.investorName}</h2>
              </div>
              <button type="button" className="modal__close" aria-label="סגירה" onClick={() => setSent(null)}>
                ×
              </button>
            </header>
            <div className="modal__body">
              <p className="confirm-sheet__message">אפשר לשלוח למשקיע הודעה שהאישור נרשם:</p>
              <pre className="on-behalf__preview">{text}</pre>
              {!waUrl ? <p className="hint">אין מספר טלפון בתיק — העתיקו את ההודעה ושלחו ידנית.</p> : null}
            </div>
            <div className="modal__actions action-bar">
              <button type="button" className="btn btn--ghost" onClick={() => setSent(null)}>
                סגירה
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))}
              >
                {copied ? "הועתק ✓" : "העתקת ההודעה"}
              </button>
              {waUrl ? (
                <a className="btn btn--gold" href={waUrl} target="_blank" rel="noopener noreferrer" onClick={() => setSent(null)}>
                  שליחה בוואטסאפ
                </a>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { start, busyId, element: (<>{dialog}{sentDialog}</>) };
}
