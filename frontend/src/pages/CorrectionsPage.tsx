import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/ConfirmDialog";
import { Panel } from "../components/Panel";
import { Toast } from "../components/Toast";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { AdminCorrections, CorrectionPayment } from "../types/investments";
import { formatCalendarMonth, formatDate, formatMoney } from "../utils/format";
import "../components/adminCorrections.css";

const WALLET_LABEL: Record<string, string> = {deposit: "תוספת כסף ליתרה", withdraw: "משיכה מהיתרה", transfer_out: "העברה בין משקיעים"};
const NOTICE_LABEL: Record<string, string> = {withdraw: "בקשת משיכה", renew: "בקשת המשך מסלול", new: "בקשה למסלול חדש"};
const AGREEMENT_KIND: Record<string, string> = {open: "פתיחת מסלול", close: "סיום מסלול", amend_dates: "עדכון מועדים"};

function investorLink(id: number | null | undefined, section?: string, extra?: Record<string, string>) {
  if (!id) return "/investors";
  const params = new URLSearchParams({investor_id: String(id), ...(section ? {section} : {}), ...(extra || {})});
  return `/investors?${params.toString()}`;
}

function Section({title, hint, count, children}: {title: string; hint: string; count: number; children: ReactNode}) {
  return (
    <Panel title={title} subtitle={hint} className="corrections-section" action={<span className="corrections-section__count" aria-label={`${count} פריטים`}>{count}</span>}>
      {count ? <ul className="corrections-list">{children}</ul> : <p className="corrections-empty">אין פריטים כרגע.</p>}
    </Panel>
  );
}

export function CorrectionsPage() {
  const {data, loading, error, reload} = useAsync(() => api.adminCorrections(), []);
  const {data: integrity, loading: integrityLoading, error: integrityError, reload: reloadIntegrity} = useAsync(() => api.adminIntegrity(), []);
  const {confirm, confirmWithReason, dialog} = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key); setMessage(null);
    try { await action(); setMessage(success); reload(); reloadIntegrity(); }
    catch (err) { setMessage(err instanceof Error ? err.message : "הפעולה נכשלה"); }
    finally { setBusy(null); }
  }

  async function reverseWallet(row: AdminCorrections["wallet"][number]) {
    const amount = formatMoney(Math.abs(row.amount), true);
    const reason = await confirmWithReason({
      title: `ביטול ${WALLET_LABEL[row.type] || "תנועה"}`,
      message: `${row.investor_name} · ${formatDate(row.created_at)} · ${amount}`,
      details: [
        row.type === "deposit" ? `${amount} יירדו מהיתרה הזמינה של ${row.investor_name}.`
          : row.type === "withdraw" ? `${amount} יחזרו ליתרה הזמינה של ${row.investor_name}.`
          : `${amount} יוחזרו מ${row.counterparty_name || "המקבל"} אל ${row.investor_name}.`,
        "הרישום המקורי נשמר בהיסטוריה ומסומן כ״בוטל״; נוספת תנועה הפוכה.",
        "שום מסלול, תשלום או הסכם אחר לא משתנה.",
      ],
      reason: {label: "סיבת הביטול", required: true, placeholder: "לדוגמה: הסכום הוקלד בטעות"},
      confirmLabel: "ביטול התנועה",
      danger: true,
    });
    if (reason === null || !row.investor_id) return;
    await run(`wallet-${row.id}`, () => api.reverseWalletEntry(row.investor_id!, row.id, reason), `${WALLET_LABEL[row.type] || "התנועה"} של ${row.investor_name} בוטלה.`);
  }

  async function cancelAgreement(row: AdminCorrections["agreements"][number]) {
    const reason = await confirmWithReason({
      title: `ביטול ${row.title} #${row.id}`,
      message: `לבטל את ההסכם של ${row.investor_name} שממתין לחתימה?`,
      details: ["קישור החתימה יפסיק לעבוד.", "לא בוצעה שום פעולה כספית — ההסכם טרם נחתם.", "המסמך נשמר בהיסטוריה תחת ״טיוטות שבוטלו״."],
      reason: {label: "סיבה (אופציונלי)"},
      confirmLabel: "ביטול ההסכם",
      danger: true,
    });
    if (reason === null) return;
    await run(`agreement-${row.id}`, () => api.cancelAgreement(row.id, reason), `הסכם #${row.id} של ${row.investor_name} בוטל.`);
  }

  async function cancelNotice(row: AdminCorrections["notices"][number]) {
    const reason = await confirmWithReason({
      title: `ביטול ${NOTICE_LABEL[row.purpose] || "בקשה"}`,
      message: `${row.investor_name} · התקבלה ${formatDate(row.requested_on)}`,
      details: ["הבקשה תסומן כ״בוטלה״ ותישאר בהיסטוריה.", "לא תתאפשר משיכה או הכנת הסכם על סמך בקשה זו.", "לא מתבצעת פעולה כספית."],
      reason: {label: "סיבה (אופציונלי)"},
      confirmLabel: "ביטול הבקשה",
      danger: true,
    });
    if (reason === null) return;
    await run(`notice-${row.id}`, () => api.cancelNotice(row.investor_id, row.id, reason), `הבקשה של ${row.investor_name} בוטלה.`);
  }

  async function revertPayment(row: CorrectionPayment) {
    const wasPaid = row.status === "paid";
    const ok = await confirm({
      title: wasPaid ? "החזרת תשלום שאושר למתוכנן" : "ביטול בקשת אישור התשלום",
      message: `${row.investor_name} · ${formatCalendarMonth(row.due_date)} · ${formatMoney(row.investor_amount, true)}`,
      details: wasPaid
        ? ["התשלום סומן כבוצע. הפעולה תחזיר אותו ל״מתוכנן״.", "סכום ״שולם בפועל״ בדוחות יקטן עד לאישור חדש.", "השינוי נרשם ביומן הפעולות."]
        : ["הבקשה תוסר מהמשקיע והתשלום יחזור ל״מתוכנן״.", "אפשר לשלוח בקשה חדשה בכל רגע."],
      confirmLabel: wasPaid ? "החזרה למתוכנן" : "ביטול הבקשה",
      danger: wasPaid,
    });
    if (!ok) return;
    await run(`payment-${row.id}`, () => api.updatePayment(row.id, {status: "scheduled"}), `התשלום של ${row.investor_name} חזר לסטטוס מתוכנן.`);
  }

  if (loading && !data) return <div className="state state--loading">טוען פעולות לתיקון...</div>;
  if (error && !data) return <div className="state state--error"><p>{error}</p><button type="button" className="btn" onClick={reload}>נסה שוב</button></div>;
  if (!data) return null;

  const total = data.agreements.length + data.wallet.length + data.notices.length + data.awaiting_payments.length + data.confirmed_payments.length + data.topups.length;

  return (
    <div className="page stack">
      <header className="page-intro page-intro--admin">
        <div>
          <h1 className="page-intro__title">ביטולים ותיקונים</h1>
          <p className="page-intro__lead">כל מה שעדיין אפשר לבטל או לשנות — במקום אחד. {total ? `${total} פריטים פתוחים.` : "אין פריטים פתוחים."}</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--ghost" onClick={reload} disabled={loading}>{loading ? "מרענן..." : "רענון"}</button>
          <Link className="btn btn--ghost" to="/activity">יומן פעולות</Link>
        </div>
      </header>

      <div className="corrections-intro">
        <strong>איך זה עובד:</strong> כל עוד מסמך לא נחתם — אפשר לערוך אותו או לבטל אותו, בלי שום השפעה כספית.
        ביטול תנועה כספית לא מוחק אותה: נוספת תנועה הפוכה, והרישום המקורי נשאר בהיסטוריה ומסומן ״בוטל״.
        הסכמים חתומים ומסלולים שנסגרו נשמרים כהיסטוריה ולא משתנים. כל ביטול נרשם ב״מעקב״ עם הסיבה.
      </div>

      <Panel
        title="בדיקת תקינות המספרים"
        subtitle="בדיקה לקריאה בלבד: יתרות מול תנועות, תשלומים פתוחים מול תנאי המסלול, מסלולים מול הסכמים חתומים. הבדיקה לא משנה שום נתון."
        className="corrections-section"
        action={<button type="button" className="btn btn--ghost btn--small" onClick={reloadIntegrity} disabled={integrityLoading}>{integrityLoading ? "בודק..." : "בדיקה חוזרת"}</button>}
      >
        {integrityError ? <p role="alert">{integrityError}</p> : !integrity ? <p className="corrections-empty">בודק...</p> : integrity.issues.length === 0 ? (
          <p className="correction-note correction-note--ok">לא נמצאו פערים. נבדקו {integrity.investors} תיקים, {integrity.plans} מסלולים ו־{integrity.payments} תשלומים.</p>
        ) : (
          <>
            <p className={`correction-note ${integrity.errors ? "correction-note--wait" : "correction-note--ok"}`}>
              נמצאו {integrity.errors} פערים ו־{integrity.warnings} הערות. שום נתון לא שונה — יש לבדוק כל שורה ולהחליט.
            </p>
            <ul className="corrections-list">
              {integrity.issues.map((row, index) => (
                <li key={index} className="corrections-row">
                  <div>
                    <div className="corrections-row__title">
                      <span className={`status-chip ${row.severity === "error" ? "status-chip--danger" : "status-chip--warn"}`}>{row.severity === "error" ? "פער" : "הערה"}</span>{" "}
                      {row.investor_name ? `${row.investor_name} · ` : ""}{row.title}
                    </div>
                    <div className="corrections-row__meta">{row.area} · {row.details}</div>
                  </div>
                  <div className="corrections-row__actions">{row.href ? <Link className="btn btn--ghost btn--small" to={row.href}>לבדיקה</Link> : null}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <div className="corrections-grid">
        <Section title="הסכמים שממתינים לחתימה" count={data.agreements.length} hint="עריכת תנאים מחליפה את ההסכם בגרסה מעודכנת; ביטול עוצר את קישור החתימה.">
          {data.agreements.map(row => (
            <li key={row.id} className="corrections-row">
              <div>
                <div className="corrections-row__title">{row.investor_name} · הסכם {AGREEMENT_KIND[row.kind] || row.title} (מס׳ {row.id}){row.expired ? <span className="status-chip status-chip--warn">פג תוקף הקישור</span> : null}</div>
                <div className="corrections-row__meta">הוכן {formatDate(row.created_at)}{row.principal ? ` · קרן ${formatMoney(Number(row.principal), true)}` : ""}{row.plan_id ? ` · מסלול #${row.plan_id}` : ""}</div>
                {!row.can_cancel ? <div className="corrections-row__blocked">ניהול הסכם זה זמין למנהל המערכת בלבד</div> : null}
              </div>
              <div className="corrections-row__actions">
                <Link className="btn btn--ghost btn--small" to={investorLink(row.investor_id, "documents")}>פתיחה</Link>
                {row.can_revise ? <Link className="btn btn--ghost btn--small" to={investorLink(row.investor_id, "documents", {revise: String(row.id)})}>עריכת תנאים</Link> : null}
                {row.can_cancel ? <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void cancelAgreement(row)}>{busy === `agreement-${row.id}` ? "מבטל..." : "ביטול"}</button> : null}
              </div>
            </li>
          ))}
        </Section>

        <Section title="תנועות ביתרה הזמינה" count={data.wallet.length} hint={`תוספות, משיכות והעברות מ־${data.wallet_window_days} הימים האחרונים שעדיין לא בוטלו.`}>
          {data.wallet.map(row => (
            <li key={row.id} className="corrections-row">
              <div>
                <div className="corrections-row__title">{row.investor_name} · {WALLET_LABEL[row.type] || row.type}{row.type === "transfer_out" && row.counterparty_name ? ` אל ${row.counterparty_name}` : ""} · {formatMoney(Math.abs(row.amount), true)}</div>
                <div className="corrections-row__meta">{formatDate(row.created_at)}{row.notes ? ` · ${row.notes}` : ""}</div>
                {row.blocked_reason ? <div className="corrections-row__blocked">{row.blocked_reason}</div> : null}
              </div>
              <div className="corrections-row__actions">
                <Link className="btn btn--ghost btn--small" to={investorLink(row.investor_id, "balance")}>לתיק</Link>
                {row.reversible ? <button type="button" className="btn btn--ghost btn--small btn--danger" disabled={busy !== null} onClick={() => void reverseWallet(row)}>{busy === `wallet-${row.id}` ? "מבטל..." : "ביטול התנועה"}</button> : null}
              </div>
            </li>
          ))}
        </Section>

        <Section title="בקשות מתועדות שטרם נוצלו" count={data.notices.length} hint="בקשות משיכה / מסלול חדש שנרשמו ועדיין לא שימשו להסכם חתום או למשיכה.">
          {data.notices.map(row => (
            <li key={row.id} className="corrections-row">
              <div>
                <div className="corrections-row__title">{row.investor_name} · {NOTICE_LABEL[row.purpose] || row.purpose}</div>
                <div className="corrections-row__meta">התקבלה {formatDate(row.requested_on)}{row.purpose === "withdraw" ? ` · ניתן למשוך מ־${formatDate(row.eligible_on)}` : ""}</div>
                {row.blocked_reason ? <div className="corrections-row__blocked">{row.blocked_reason}</div> : null}
              </div>
              <div className="corrections-row__actions">
                <Link className="btn btn--ghost btn--small" to={investorLink(row.investor_id, "requests")}>לתיק</Link>
                {row.cancellable ? <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void cancelNotice(row)}>{busy === `notice-${row.id}` ? "מבטל..." : "ביטול הבקשה"}</button> : null}
              </div>
            </li>
          ))}
        </Section>

        <Section title="בקשות אישור תשלום פתוחות" count={data.awaiting_payments.length} hint="נשלחו למשקיע וממתינות לאישור קבלה. אפשר לבטל ולשלוח מחדש.">
          {data.awaiting_payments.map(row => (
            <li key={row.id} className="corrections-row">
              <div>
                <div className="corrections-row__title">{row.investor_name} · {formatCalendarMonth(row.due_date)} · {formatMoney(row.investor_amount, true)}</div>
                <div className="corrections-row__meta">מועד {formatDate(row.due_date)}{row.confirmation_requested_at ? ` · נשלח ${formatDate(row.confirmation_requested_at)}` : ""}</div>
              </div>
              <div className="corrections-row__actions">
                <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void revertPayment(row)}>{busy === `payment-${row.id}` ? "מבטל..." : "ביטול הבקשה"}</button>
              </div>
            </li>
          ))}
        </Section>

        <Section title="תשלומים שאושרו לאחרונה" count={data.confirmed_payments.length} hint={`תשלומים שסומנו כבוצעו ב־${data.confirmed_window_days} הימים האחרונים. להחזרה רק במקרה של טעות.`}>
          {data.confirmed_payments.map(row => (
            <li key={row.id} className="corrections-row">
              <div>
                <div className="corrections-row__title">{row.investor_name} · {formatCalendarMonth(row.due_date)} · {formatMoney(row.investor_amount, true)}</div>
                <div className="corrections-row__meta">אושר {row.paid_at ? formatDate(row.paid_at) : "—"}</div>
              </div>
              <div className="corrections-row__actions">
                <button type="button" className="btn btn--ghost btn--small btn--danger" disabled={busy !== null} onClick={() => void revertPayment(row)}>{busy === `payment-${row.id}` ? "מעדכן..." : "החזרה למתוכנן"}</button>
              </div>
            </li>
          ))}
        </Section>

        <Section title="בקשות מסלול בטיפול" count={data.topups.length} hint="בקשות שהמשקיעים פתחו. דחייה, ביטול או הכנת חוזה — מתוך תיק המשקיע.">
          {data.topups.map(row => (
            <li key={row.id} className="corrections-row">
              <div>
                <div className="corrections-row__title">{row.investor_name} · {formatMoney(row.amount, true)}</div>
                <div className="corrections-row__meta">בקשה #{row.id} · {row.status === "contract" ? "חוזה ממתין לחתימות" : "ממתינה לבדיקה"} · {formatDate(row.created_at)}</div>
              </div>
              <div className="corrections-row__actions">
                <Link className="btn btn--ghost btn--small" to={investorLink(row.investor_id, "requests", {topup_request_id: String(row.id)})}>לטיפול</Link>
              </div>
            </li>
          ))}
        </Section>
      </div>
      <Toast message={message} onClear={() => setMessage(null)} />
      {dialog}
    </div>
  );
}
