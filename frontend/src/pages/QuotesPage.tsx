import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QuotePipelineStepper, quoteNextStepHint } from "../components/QuotePipelineStepper";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { PlanTrackFields } from "../components/PlanTrackFields";
import { Toast } from "../components/Toast";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Quote } from "../types/investments";
import { suggestPassword, suggestUsername } from "../utils/quoteAccess";
import { buildMonthSchedule, downloadQuotePdf, quotePdfDisplayLabel, quotePdfFile, saveQuotePdfFile } from "../utils/quotePdf";
import { formatDate, formatMoney, formatPercent, todayISO } from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";
import {
  canApproveQuote,
  canConvertQuote,
  canEditQuote,
  canRejectQuote,
  canSendQuoteAccessMessage,
  isCompletedQuote,
  isPipelineQuote,
  isRejectedQuote,
  normalizeQuoteStatus,
  quoteMoneyPhaseLabel,
  quoteStatusLabel,
  type QuoteViewTab,
} from "../utils/quoteStatus";
import {
  buildQuoteWhatsAppShareMessage,
  canSharePdfFile,
  formatPhoneDisplay,
  isShareAbort,
  shareQuotePdf,
  toWhatsAppNumber,
  whatsAppAccessUrl,
  whatsAppQuoteShareUrl,
} from "../utils/whatsapp";

export function QuotesPage() {
  const { data: settings } = useAsync(() => api.settings(), []);
  const { data: siteStatus } = useAsync(() => api.siteStatus(), []);
  const { data, error, loading, reload } = useAsync(() => api.quotes(), []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<number | null>(null);
  const [converting, setConverting] = useState<Quote | null>(null);
  const [whatsappSend, setWhatsappSend] = useState<{ quote: Quote; file: File } | null>(null);
  const [whatsappShareBusy, setWhatsappShareBusy] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [draftPassword] = useState(() => suggestPassword());
  const [busy, setBusy] = useState(false);
  const [viewTab, setViewTab] = useState<QuoteViewTab>("pipeline");
  const clearMessage = useCallback(() => setMessage(null), []);

  const allQuotes = useMemo(() => data ?? [], [data]);
  const pipelineQuotes = useMemo(
    () => allQuotes.filter((q) => isPipelineQuote(q.status)),
    [allQuotes],
  );
  const completedQuotes = useMemo(
    () => allQuotes.filter((q) => isCompletedQuote(q.status)),
    [allQuotes],
  );
  const rejectedQuotes = useMemo(
    () => allQuotes.filter((q) => isRejectedQuote(q.status)),
    [allQuotes],
  );
  const preview =
    viewTab === "pipeline"
      ? pipelineQuotes
      : viewTab === "completed"
        ? completedQuotes
        : rejectedQuotes;
  const tabCounts = {
    pipeline: pipelineQuotes.length,
    completed: completedQuotes.length,
    rejected: rejectedQuotes.length,
  };
  const publicUrl = siteStatus?.public_url || window.location.origin;
  const formOpen = showForm || editing != null;
  const backfilling = useRef(false);
  const accessAttempted = useRef(new Set<number>());

  const persistQuoteAccess = useCallback(async (quote: Quote): Promise<Quote> => {
    const status = normalizeQuoteStatus(quote.status);
    if (status === "converted" || status === "rejected") return quote;
    if (quote.access_username && quote.access_password && quote.start_date) return quote;
    return api.updateQuote(quote.id, {
      access_username: quote.access_username || suggestUsername(quote.prospect_name, quote.phone),
      access_password: quote.access_password || suggestPassword(),
      start_date: quote.start_date || todayISO(),
    });
  }, []);

  useEffect(() => {
    if (!data || backfilling.current) return;
    const missing = data.filter(
      (q) =>
        normalizeQuoteStatus(q.status) !== "converted" &&
        normalizeQuoteStatus(q.status) !== "rejected" &&
        !accessAttempted.current.has(q.id) &&
        (!q.access_username || !q.access_password || !q.start_date),
    );
    if (missing.length === 0) return;
    backfilling.current = true;
    void (async () => {
      let changed = false;
      try {
        for (const quote of missing) {
          try {
            await persistQuoteAccess(quote);
            accessAttempted.current.add(quote.id);
            changed = true;
          } catch {
            accessAttempted.current.delete(quote.id);
          }
        }
        if (changed) reload();
      } finally {
        backfilling.current = false;
      }
    })();
  }, [data, persistQuoteAccess, reload]);

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("prospect_name") || "").trim();
    const phone = String(fd.get("phone") || "").trim() || undefined;
    const body = {
      prospect_name: name,
      phone,
      access_username:
        String(fd.get("access_username") || "").trim().toLowerCase() ||
        suggestUsername(name, phone),
      access_password: String(fd.get("access_password") || "").trim() || suggestPassword(),
      start_date: String(fd.get("start_date") || todayISO()),
      principal: Number(fd.get("principal") || 0),
      plan_type: String(fd.get("plan_type") || "monthly"),
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
      savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
      manager_fee_percent: Number(
        editing?.manager_fee_percent ?? settings?.default_manager_fee_percent ?? 0,
      ),
      duration_months: Number(fd.get("duration_months") || 12),
      notes: String(fd.get("notes") || "") || undefined,
    };
    try {
      if (editing) {
        await api.updateQuote(editing.id, body);
        setMessage(`ההצעה ל-${body.prospect_name} עודכנה`);
      } else {
        await api.createQuote(body);
        setMessage("הצעת סיכום נוצרה");
      }
      closeForm();
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת ההצעה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function setQuoteStatus(quote: Quote, status: "approved" | "rejected" | "pending") {
    try {
      await api.updateQuote(quote.id, { status });
      const label = quoteStatusLabel(status);
      setMessage(
        status === "rejected"
          ? `ההצעה ל-${quote.prospect_name} סומנה כ"${label}"`
          : `ההצעה ל-${quote.prospect_name} עודכנה ל"${label}"`,
      );
      if (status === "rejected") setViewTab("rejected");
      else if (status === "approved") setViewTab("pipeline");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון הסטטוס נכשל");
    }
  }

  async function rejectQuote(quote: Quote) {
    if (!window.confirm(`לסמן את ההצעה ל-${quote.prospect_name} כ"לא אושר"?`)) return;
    await setQuoteStatus(quote, "rejected");
  }

  async function removeQuote(quote: Quote) {
    if (normalizeQuoteStatus(quote.status) === "converted") {
      setMessage("לא ניתן למחוק הצעה שהושלמה ונפתח מסלול");
      return;
    }
    if (!window.confirm(`למחוק את ההצעה ל-${quote.prospect_name}?`)) return;
    try {
      await api.deleteQuote(quote.id);
      if (editing?.id === quote.id) closeForm();
      if (expandedId === quote.id) setExpandedId(null);
      setMessage(`ההצעה ל-${quote.prospect_name} נמחקה`);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקה נכשלה");
    }
  }

  async function convertQuote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!converting) return;
    const fd = new FormData(e.currentTarget);
    const start_date = String(fd.get("start_date") || todayISO());
    const username = String(fd.get("username") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "").trim();
    setConvertError(null);
    setBusy(true);
    try {
      const plan = await api.convertQuote(converting.id, {
        start_date,
        username,
        password,
        phone: converting.phone || undefined,
      });
      setConverting(null);
      setViewTab("completed");
      setMessage(
        `${plan.investor_name} נוסף למשקיעים עם מסלול פעיל. כניסה: ${username}`,
      );
      reload();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "הוספת המשקיע נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function sendWhatsApp(quote: Quote) {
    if (!toWhatsAppNumber(quote.phone)) {
      setMessage("הוסיפו מספר טלפון תקין להצעה כדי לשלוח בוואטסאפ");
      setEditing(quote);
      setShowForm(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setPdfBusyId(quote.id);
    setMessage(null);
    try {
      const ready = await persistQuoteAccess(quote);
      const file = await quotePdfFile(ready);
      saveQuotePdfFile(file);
      setWhatsappSend({ quote: ready, file });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחה בוואטסאפ נכשלה");
    } finally {
      setPdfBusyId(null);
    }
  }

  async function shareWhatsappPdf() {
    if (!whatsappSend) return;
    setWhatsappShareBusy(true);
    try {
      await shareQuotePdf(
        whatsappSend.quote,
        whatsappSend.file,
        buildQuoteWhatsAppShareMessage(whatsappSend.quote, publicUrl),
      );
      const name = whatsappSend.quote.prospect_name;
      setWhatsappSend(null);
      setMessage(`בחרו וואטסאפ — הקובץ ${name} יצורף להודעה`);
      reload();
    } catch (err) {
      if (!isShareAbort(err)) {
        setMessage(err instanceof Error ? err.message : "שיתוף הקובץ נכשל");
      }
    } finally {
      setWhatsappShareBusy(false);
    }
  }

  function openWhatsappChat() {
    if (!whatsappSend) return;
    const { quote, file } = whatsappSend;
    const url = whatsAppQuoteShareUrl(quote, publicUrl);
    if (!url) {
      setMessage("לא ניתן לפתוח וואטסאפ — בדקו את מספר הטלפון");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setWhatsappSend(null);
    setMessage(
      canSendQuoteAccessMessage(quote.status)
        ? `צרפו את "${quotePdfDisplayLabel(quote)}" בוואטסאפ (📎) ואז שלחו את ההודעה עם פרטי הכניסה`
        : `צרפו את "${quotePdfDisplayLabel(quote)}" בוואטסאפ (📎) ואז שלחו את ההודעה`,
    );
    reload();
  }

  function openQuoteAccessWhatsApp(quote: Quote) {
    if (!canSendQuoteAccessMessage(quote.status)) {
      setMessage("פרטי כניסה נשלחים רק אחרי אישור וביצוע העברה ופתיחת מסלול");
      return;
    }
    const url = whatsAppAccessUrl(
      {
        name: quote.prospect_name,
        phone: quote.phone,
        access_username: quote.access_username,
        access_password: quote.access_password,
      },
      publicUrl,
    );
    if (!url) {
      setMessage("לא ניתן לפתוח וואטסאפ — בדקו את מספר הטלפון");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setMessage(`נפתחה הודעת כניסה מוכנה עבור ${quote.prospect_name}`);
  }

  async function copyWhatsappText() {
    if (!whatsappSend) return;
    try {
      await navigator.clipboard.writeText(
        buildQuoteWhatsAppShareMessage(whatsappSend.quote, publicUrl),
      );
      setMessage("טקסט ההודעה הועתק — הדביקו בוואטסאפ אחרי צירוף הקובץ");
    } catch {
      setMessage("לא ניתן להעתיק — העתיקו ידנית מהתצוגה");
    }
  }

  async function exportPdf(quote: Quote) {
    setPdfBusyId(quote.id);
    setMessage(null);
    try {
      const ready = await persistQuoteAccess(quote);
      await downloadQuotePdf(ready);
      setMessage(`הקובץ PDF עבור ${ready.prospect_name} ירד בהצלחה`);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ייצוא PDF נכשל");
    } finally {
      setPdfBusyId(null);
    }
  }

  if (loading) return <div className="state">טוען הצעות...</div>;
  if (error)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={reload}>
          נסה שוב
        </button>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>הצעות למשקיעים חדשים</h1>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          הצעה חדשה
        </button>
      </div>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}

      {formOpen ? (
        <Panel
          title={editing ? `עריכת הצעה — ${editing.prospect_name}` : "סיכום הצעה"}
          subtitle="בחרו סוג מסלול: החזר חודשי, חיסכון או משולב"
        >
          <form className="form" onSubmit={onSave} key={editing?.id ?? "new"}>
            <div className="form__grid">
              <label>
                שם המועמד/ת
                <input
                  name="prospect_name"
                  required
                  placeholder="שם"
                  defaultValue={editing?.prospect_name ?? ""}
                  onBlur={(e) => {
                    const form = e.currentTarget.form;
                    if (!form) return;
                    const user = form.elements.namedItem("access_username") as HTMLInputElement | null;
                    const phone = form.elements.namedItem("phone") as HTMLInputElement | null;
                    if (user && !user.value.trim()) {
                      user.value = suggestUsername(e.currentTarget.value, phone?.value);
                    }
                  }}
                />
              </label>
              <label>
                טלפון בוואטסאפ
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  placeholder="050-0000000"
                  defaultValue={editing?.phone ?? ""}
                />
              </label>
              <label>
                תחילת המסלול
                <input
                  name="start_date"
                  type="date"
                  dir="ltr"
                  required
                  defaultValue={editing?.start_date ?? todayISO()}
                />
              </label>
              <label>
                שם משתמש לכניסה
                <input
                  name="access_username"
                  minLength={2}
                  maxLength={64}
                  dir="ltr"
                  autoComplete="off"
                  pattern="[A-Za-z0-9._\\-]{2,64}"
                  title="אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון"
                  placeholder="ייווצר אוטומטית מהשם, באנגלית"
                  defaultValue={editing?.access_username ?? ""}
                />
              </label>
              <PasswordField
                name="access_password"
                label="סיסמה לכניסה"
                required
                minLength={8}
                dir="ltr"
                autoComplete="new-password"
                defaultValue={editing?.access_password ?? draftPassword}
              />
              <label>
                קרן מוצעת (₪)
                <input
                  name="principal"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={editing?.principal ?? 0}
                />
              </label>
              <PlanTrackFields
                defaultPlanType={editing?.plan_type ?? "monthly"}
                defaultMonthlyRate={
                  editing?.monthly_rate_percent ?? settings?.default_monthly_rate_percent ?? 0
                }
                defaultSavingsRate={editing?.savings_rate_percent ?? 0}
                defaultPrincipal={editing?.principal ?? 0}
              />
              <label>
                משך
                <select
                  name="duration_months"
                  defaultValue={editing?.duration_months ?? 12}
                >
                  {[12, 14, 18, 24].map((m) => (
                    <option key={m} value={m}>
                      {m} חודשים
                    </option>
                  ))}
                </select>
              </label>
              <label>
                הערות
                <input name="notes" defaultValue={editing?.notes ?? ""} />
              </label>
            </div>
            <div className="page-head__actions">
              <button type="button" className="btn btn--ghost" onClick={closeForm}>
                ביטול
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "שומר..." : editing ? "שמור שינויים" : "שמור הצעה"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <div className="track-view-switch quote-view-switch" role="tablist" aria-label="סינון הצעות">
        <button
          type="button"
          role="tab"
          aria-selected={viewTab === "pipeline"}
          className={
            viewTab === "pipeline" ? "track-view-switch__btn is-active" : "track-view-switch__btn"
          }
          onClick={() => setViewTab("pipeline")}
        >
          בתהליך
          <em>{tabCounts.pipeline}</em>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewTab === "completed"}
          className={
            viewTab === "completed" ? "track-view-switch__btn is-active" : "track-view-switch__btn"
          }
          onClick={() => setViewTab("completed")}
        >
          הושלמו
          <em>{tabCounts.completed}</em>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewTab === "rejected"}
          className={
            viewTab === "rejected" ? "track-view-switch__btn is-active" : "track-view-switch__btn"
          }
          onClick={() => setViewTab("rejected")}
        >
          לא אושרו
          <em>{tabCounts.rejected}</em>
        </button>
      </div>

      <div className="quotes-grid">
        {preview.length === 0 ? (
          <p className="empty">
            {viewTab === "pipeline"
              ? "אין הצעות בתהליך. צרו הצעה חדשה או בדקו בלשונית «הושלמו»."
              : viewTab === "completed"
                ? "אין עדיין הצעות שהושלמו. אחרי «הכנס כמשקיע חדש» ההצעה תופיע כאן."
                : "אין הצעות שלא אושרו."}
          </p>
        ) : (
          preview.map((q) => {
            const rows = buildMonthSchedule(q);
            const open = expandedId === q.id;
            const status = normalizeQuoteStatus(q.status);
            const editable = canEditQuote(q.status);
            const nextHint = quoteNextStepHint(q.status);
            const cardClass =
              viewTab === "completed"
                ? "quote-card quote-card--completed"
                : viewTab === "rejected"
                  ? "quote-card quote-card--rejected"
                  : "quote-card quote-card--pipeline";
            return (
              <article key={q.id} className={cardClass}>
                <QuotePipelineStepper status={q.status} />
                <header>
                  <div>
                    <h2>{q.prospect_name}</h2>
                    {q.phone ? (
                      <p className="quote-card__phone">
                        <a href={`tel:${q.phone.replace(/\s+/g, "")}`}>{formatPhoneDisplay(q.phone)}</a>
                      </p>
                    ) : (
                      <p className="quote-card__phone muted">אין מספר טלפון</p>
                    )}
                    {q.start_date ? (
                      <p className="quote-card__phone muted">תחילת מסלול {formatDate(q.start_date)}</p>
                    ) : null}
                  </div>
                  <span className={`badge badge--${status}`}>{quoteStatusLabel(q.status)}</span>
                </header>
                <p className="quote-phase-line">{quoteMoneyPhaseLabel(q.status)}</p>
                {nextHint && viewTab === "pipeline" ? (
                  <p className="quote-next-hint">{nextHint}</p>
                ) : null}
                <p className="quote-card__lead">
                  {planTypeLabel(q.plan_type)} · קרן {formatMoney(q.principal)} ·{" "}
                  {q.plan_type === "savings"
                    ? `${formatPercent(q.savings_rate_percent)} לחיסכון`
                    : q.plan_type === "hybrid"
                      ? `${formatPercent(q.monthly_rate_percent)} חודשי + ${formatPercent(q.savings_rate_percent)} חיסכון`
                      : `${formatPercent(q.monthly_rate_percent)} לחודש`}{" "}
                  · {q.duration_months} חודשים
                </p>
                <dl className="quote-dl">
                  {q.plan_type !== "savings" ? (
                    <div>
                      <dt>רווח חודשי (מזומן)</dt>
                      <dd>{formatMoney(q.monthly_investor_payout, true)}</dd>
                    </div>
                  ) : null}
                  {q.plan_type !== "monthly" ? (
                    <div>
                      <dt>צבירת חיסכון חודשית (התחלה)</dt>
                      <dd>{formatMoney(q.monthly_savings_accrual, true)}</dd>
                    </div>
                  ) : null}
                  {q.plan_type !== "monthly" ? (
                    <div>
                      <dt>יתרת חיסכון בסיום (ריבית דריבית)</dt>
                      <dd>{formatMoney(q.projected_savings_balance)}</dd>
                    </div>
                  ) : null}
                  {q.plan_type !== "monthly" ? (
                    <div>
                      <dt>קרן + חיסכון בסיום</dt>
                      <dd>{formatMoney(q.principal + q.projected_savings_balance)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>סה״כ רווח בסיום המסלול</dt>
                    <dd>{formatMoney(q.total_investor_payout)}</dd>
                  </div>
                  <div>
                    <dt>קרן + רווח בסיום</dt>
                    <dd>{formatMoney(q.principal + q.total_investor_payout)}</dd>
                  </div>
                </dl>
                {canSendQuoteAccessMessage(q.status) && (q.access_username || q.access_password) ? (
                  <div className="quote-access">
                    <p className="quote-access__label">כניסה לאתר תזרים</p>
                    <dl>
                      {q.access_username ? (
                        <div>
                          <dt>שם משתמש</dt>
                          <dd className="ltr">{q.access_username}</dd>
                        </div>
                      ) : null}
                      {q.access_password ? (
                        <div>
                          <dt>סיסמה</dt>
                          <dd className="ltr">{q.access_password}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setExpandedId(open ? null : q.id)}
                >
                  {open ? "הסתרת מפרט חודשי" : "הצגת מפרט חודשי"}
                </button>

                {open ? (
                  <div className="table-wrap quote-months">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>חודש</th>
                          {q.plan_type !== "savings" ? <th>החזר חודשי</th> : null}
                          {q.plan_type !== "monthly" ? <th>לחיסכון</th> : null}
                          <th>רווח מצטבר</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.month}>
                            <td>
                              {r.month}
                              {r.compounded ? " · ריבית דריבית" : ""}
                            </td>
                            {q.plan_type !== "savings" ? (
                              <td>{formatMoney(r.profit, true)}</td>
                            ) : null}
                            {q.plan_type !== "monthly" ? (
                              <td>{formatMoney(r.savings, true)}</td>
                            ) : null}
                            <td>
                              {formatMoney(
                                r.cumulative + (q.plan_type === "monthly" ? 0 : r.cumulativeSavings),
                                true,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="quote-total">
                      סה״כ רווח בסוף {q.duration_months} חודשים:{" "}
                      <strong>{formatMoney(q.total_investor_payout)}</strong>
                    </p>
                  </div>
                ) : null}

                <div className="page-head__actions">
                  {viewTab === "pipeline" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--whatsapp"
                        disabled={pdfBusyId === q.id}
                        onClick={() => sendWhatsApp(q)}
                      >
                        {pdfBusyId === q.id ? "מכינים PDF..." : "שליחת PDF בוואטסאפ"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={pdfBusyId === q.id}
                        onClick={() => exportPdf(q)}
                      >
                        {pdfBusyId === q.id ? "מכינים PDF..." : "הורדת PDF"}
                      </button>
                      {canApproveQuote(q.status) ? (
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => void setQuoteStatus(q, "approved")}
                        >
                          סימון כאושר
                        </button>
                      ) : null}
                      {canRejectQuote(q.status) ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--danger"
                          onClick={() => void rejectQuote(q)}
                        >
                          לא אושר
                        </button>
                      ) : null}
                      {editable ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => {
                              setShowForm(false);
                              setEditing(q);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            עריכה
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--danger"
                            onClick={() => removeQuote(q)}
                          >
                            מחיקה
                          </button>
                        </>
                      ) : null}
                      {canConvertQuote(q.status) ? (
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => {
                            setConvertError(null);
                            setConverting(q);
                          }}
                        >
                          הכנס כמשקיע חדש
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {viewTab === "completed" ? (
                    <>
                      <Link
                        to="/investors"
                        className="btn btn--primary"
                      >
                        מסך משקיעים #{q.converted_investor_id}
                      </Link>
                      <button
                        type="button"
                        className="btn btn--whatsapp"
                        onClick={() => openQuoteAccessWhatsApp(q)}
                      >
                        שליחת כניסה בוואטסאפ
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={pdfBusyId === q.id}
                        onClick={() => exportPdf(q)}
                      >
                        {pdfBusyId === q.id ? "מכינים PDF..." : "הורדת PDF"}
                      </button>
                    </>
                  ) : null}
                  {viewTab === "rejected" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={pdfBusyId === q.id}
                        onClick={() => exportPdf(q)}
                      >
                        {pdfBusyId === q.id ? "מכינים PDF..." : "הורדת PDF"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--danger"
                        onClick={() => removeQuote(q)}
                      >
                        מחיקה
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => void setQuoteStatus(q, "pending")}
                      >
                        החזרה לתהליך
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      {converting ? (
        <div className="modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => setConverting(null)}
          />
          <div className="modal__sheet request-sheet">
            <header className="modal__head">
              <div>
                <p className="contract-kicker">קליטת משקיע</p>
                <h2>{converting.prospect_name}</h2>
              </div>
              <button type="button" className="modal__close" aria-label="סגירה" onClick={() => setConverting(null)}>
                ×
              </button>
            </header>
            <form className="request-form" onSubmit={convertQuote}>
              <p className="request-form__lead">
                {planTypeLabel(converting.plan_type)} · קרן {formatMoney(converting.principal)} ·{" "}
                {converting.duration_months} חודשים. ייפתח משקיע חדש עם מסלול פעיל לפי ההצעה.
              </p>
              {convertError ? <p className="form-error">{convertError}</p> : null}
              <label>
                תחילת המסלול
                <input
                  name="start_date"
                  type="date"
                  dir="ltr"
                  required
                  defaultValue={converting.start_date ?? todayISO()}
                />
              </label>
              <label>
                שם משתמש לכניסה (אנגלית)
                <input
                  name="username"
                  required
                  minLength={2}
                  maxLength={64}
                  dir="ltr"
                  autoComplete="off"
                  pattern="[A-Za-z0-9._\\-]{2,64}"
                  title="אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון"
                  defaultValue={
                    converting.access_username ||
                    suggestUsername(converting.prospect_name, converting.phone)
                  }
                />
              </label>
              <PasswordField
                name="password"
                label="סיסמה"
                required
                minLength={8}
                dir="ltr"
                autoComplete="new-password"
                defaultValue={converting.access_password || draftPassword}
              />
              <div className="request-form__actions">
                <button type="button" className="btn btn--ghost" onClick={() => setConverting(null)} disabled={busy}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {busy ? "מוסיף..." : "הוספה למשקיעים"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {whatsappSend ? (
        <div className="modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => setWhatsappSend(null)}
          />
          <div className="modal__sheet request-sheet">
            <header className="modal__head">
              <div>
                <p className="contract-kicker">שליחה בוואטסאפ</p>
                <h2>{whatsappSend.quote.prospect_name}</h2>
              </div>
              <button
                type="button"
                className="modal__close"
                aria-label="סגירה"
                onClick={() => setWhatsappSend(null)}
              >
                ×
              </button>
            </header>
            <div className="request-form">
              <p className="request-form__lead">
                הקובץ ירד למחשב. וואטסאפ בדפדפן לא מצרף קבצים אוטומטית — צריך לצרף את ה-PDF
                ידנית לפני השליחה.
              </p>
              <p className="whatsapp-send__file">
                {quotePdfDisplayLabel(whatsappSend.quote)}
                <span className="whatsapp-send__file-tech">{whatsappSend.file.name}</span>
              </p>
              <ol className="whatsapp-send__steps">
                <li>
                  לחצו <strong>פתיחת וואטסאפ</strong> (או פתחו את הצ&apos;אט עם{" "}
                  {formatPhoneDisplay(whatsappSend.quote.phone)}).
                </li>
                <li>
                  בוואטסאפ לחצו <strong>📎 צירוף</strong> → <strong>מסמך</strong> → בחרו את הקובץ
                  שהורד.
                </li>
                <li>
                  {canSendQuoteAccessMessage(whatsappSend.quote.status)
                    ? "שלחו את ההודעה — היא כוללת קישור לאתר, שם משתמש וסיסמה (רק אחרי ביצוע העברה)."
                    : "שלחו את ההודעה הקצרה על ההצעה — פרטי כניסה יישלחו רק אחרי אישור וביצוע העברה."}
                </li>
              </ol>
              <p className="whatsapp-send__preview">
                {buildQuoteWhatsAppShareMessage(whatsappSend.quote, publicUrl)}
              </p>
              <div className="whatsapp-send__actions">
                <button type="button" className="btn btn--ghost" onClick={() => setWhatsappSend(null)}>
                  סגור
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => void copyWhatsappText()}>
                  העתקת טקסט
                </button>
                {canSharePdfFile(whatsappSend.file) ? (
                  <button
                    type="button"
                    className="btn btn--whatsapp"
                    disabled={whatsappShareBusy}
                    onClick={() => void shareWhatsappPdf()}
                  >
                    {whatsappShareBusy ? "משתף..." : "שיתוף עם הקובץ (טלפון)"}
                  </button>
                ) : null}
                <button type="button" className="btn btn--primary" onClick={openWhatsappChat}>
                  פתיחת וואטסאפ
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
