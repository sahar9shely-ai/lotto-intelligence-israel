import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { AuthUser } from "../types/auth";
import type { PlanAgreement } from "../types/investments";
import { isAdminPushAccount, type AgreementReminderResult } from "../types/push";
import { isAgreementExpired } from "../utils/agreementSigning";
import "./agreementReminderAction.css";

type Props = { agreement: PlanAgreement; recipientName?: string };

export function canRemindAgreement(user: AuthUser | null | undefined, agreement: PlanAgreement): boolean {
  return isAdminPushAccount(user) && agreement.status === "pending" && !isAgreementExpired(agreement)
    && Number.isInteger(agreement.id) && agreement.id > 0 && Boolean(agreement.document_hash);
}

function nextEligibleLabel(value?: string | null) {
  if (!value) return "";
  const utcValue = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(utcValue);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(date) : "";
}

export function agreementReminderMessage(result: AgreementReminderResult, recipientName: string): string {
  if (result.reason === "no_devices") return `ל${recipientName} אין מכשיר רשום להתראות. יש להפעיל התראות בתזרים; אפשר להעביר את קישור החתימה בנפרד.`;
  if (result.reason === "already_pending") return `כבר יש תזכורת לחתימה בתור השליחה עבור ${recipientName}. לא נוספה תזכורת נוספת.`;
  if (result.reason === "recently_sent") {
    const next = nextEligibleLabel(result.next_eligible_at);
    return `תזכורת כבר הוכנה לאחרונה עבור ${recipientName}.${next ? ` אפשר לשלוח שוב ב־${next}.` : " אפשר לשלוח שוב בהמשך."}`;
  }
  return `התזכורת לחתימה עבור ${recipientName} נוספה לתור השליחה. היא תישלח למכשירים הרשומים להתראות.`;
}

export function AgreementReminderAction({ agreement, recipientName }: Props) {
  const { user } = useAuth();
  if (!canRemindAgreement(user, agreement)) return null;
  const name = recipientName || agreement.snapshot.investor_name;
  return <ReminderReview key={`${user!.id}:${agreement.id}:${agreement.investor_id}:${agreement.document_hash}:${name}:${agreement.snapshot.title}`} user={user!} agreement={agreement} recipientName={name} />;
}

function ReminderReview({ user, agreement, recipientName }: Props & { user: AuthUser; recipientName: string }) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgreementReminderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const reviewed = useRef<{ agreementId: number; investorId: number; documentHash: string; title: string; name: string } | null>(null);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; reviewed.current = null; controller.current?.abort(); };
  }, []);

  function openReview() {
    if (busyRef.current || !canRemindAgreement(user, agreement)) return;
    setError(null);
    setResult(null);
    reviewed.current = { agreementId: agreement.id, investorId: agreement.investor_id, documentHash: agreement.document_hash, title: agreement.snapshot.title, name: recipientName };
    setReviewing(true);
  }

  async function send() {
    const confirmation = reviewed.current;
    if (!active.current || !confirmation || busyRef.current) return;
    if (!canRemindAgreement(user, agreement)) {
      reviewed.current = null;
      setReviewing(false);
      setError("ההסכם כבר אינו זמין לחתימה. יש לרענן את הרשימה לפני שליחת תזכורת.");
      return;
    }
    if (confirmation.agreementId !== agreement.id || confirmation.investorId !== agreement.investor_id
      || confirmation.documentHash !== agreement.document_hash || confirmation.title !== agreement.snapshot.title || confirmation.name !== recipientName) {
      reviewed.current = null;
      setReviewing(false);
      setError("פרטי ההסכם השתנו. יש לבדוק את התזכורת מחדש לפני שליחה.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const request = new AbortController();
    controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 20000);
    try {
      const response = await api.remindAgreement(confirmation.agreementId, { document_hash: confirmation.documentHash }, request.signal);
      if (!active.current) return;
      setResult(response);
      reviewed.current = null;
      setReviewing(false);
    } catch (failure) {
      if (!active.current) return;
      setError(request.signal.aborted ? "לא ניתן לאמת כרגע את השליחה. אפשר לרענן את התור ולבדוק שוב."
        : failure instanceof Error ? failure.message : "שליחת התזכורת לא הושלמה. אפשר לנסות שוב.");
    } finally {
      window.clearTimeout(timeout);
      if (active.current) { busyRef.current = false; controller.current = null; setBusy(false); }
    }
  }

  return <div className={`agreement-reminder${reviewing ? " agreement-reminder--review" : ""}`}>
    {!reviewing ? <button type="button" className="btn btn--small btn--ghost" onClick={openReview}>שליחת תזכורת לחתימה</button> : <section className="agreement-reminder__review" aria-label="אישור שליחת תזכורת לחתימה" aria-busy={busy}>
      <strong>בדיקת התזכורת לפני השליחה</strong>
      <dl><div><dt>משקיע</dt><dd>{recipientName}</dd></div><div><dt>מסמך לחתימה</dt><dd>{agreement.snapshot.title} · הסכם #{agreement.id}</dd></div></dl>
      <p>תישלח התראה למכשירים הרשומים של המשקיע, עם מעבר להסכם הזה.</p>
      <div className="agreement-reminder__actions">
        <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => void send()}>{busy ? "מכניסים תזכורת לשליחה…" : "אישור ושליחת תזכורת"}</button>
        <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={() => { reviewed.current = null; setReviewing(false); setError(null); }}>ביטול</button>
      </div>
    </section>}
    {result ? <p className={`agreement-reminder__result${result.reason === "no_devices" ? " agreement-reminder__result--warning" : ""}`} role="status" aria-live="polite">{agreementReminderMessage(result, recipientName)}</p> : null}
    {error ? <p className="agreement-reminder__result agreement-reminder__result--warning" role="alert">{error}</p> : null}
  </div>;
}
