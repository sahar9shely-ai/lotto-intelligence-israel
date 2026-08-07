import { FormEvent, useCallback, useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { PlanTrackFields } from "../components/PlanTrackFields";
import { Toast } from "../components/Toast";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Quote } from "../types/investments";
import { buildMonthSchedule, downloadQuotePdf } from "../utils/quotePdf";
import { formatMoney, formatPercent, statusLabel, yearStartISO } from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";

export function QuotesPage() {
  const { data: settings } = useAsync(() => api.settings(), []);
  const { data, error, loading, reload } = useAsync(() => api.quotes(), []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const clearMessage = useCallback(() => setMessage(null), []);

  const preview = useMemo(() => data ?? [], [data]);
  const formOpen = showForm || editing != null;

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      prospect_name: String(fd.get("prospect_name") || "").trim(),
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

  async function removeQuote(quote: Quote) {
    if (quote.status === "converted") {
      setMessage("לא ניתן למחוק הצעה שכבר הומרה למשקיע");
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

  async function convert(id: number, name: string) {
    const start = window.prompt(`תאריך התחלה ל-${name} (YYYY-MM-DD)`, yearStartISO());
    if (!start) return;
    const username = window.prompt(`שם משתמש לגישה של ${name}`, "")?.trim();
    if (!username) {
      setMessage("לא ניתן להמיר בלי שם משתמש — אפשר גם ליצור משתמש ממסך משתמשים והרשאות");
      return;
    }
    const password = window.prompt(`סיסמה התחלתית ל-${name} (לפחות 8 תווים)`, "")?.trim();
    if (!password || password.length < 8) {
      setMessage("סיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    await api.convertQuote(id, { start_date: start, username, password });
    setMessage(`${name} הומר למשקיע חדש — התחברות: ${username}`);
    reload();
  }

  async function exportPdf(quote: Quote) {
    setPdfBusyId(quote.id);
    setMessage(null);
    try {
      await downloadQuotePdf(quote);
      setMessage(`הקובץ PDF עבור ${quote.prospect_name} ירד בהצלחה`);
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
          <p className="muted">החזר חודשי · חיסכון · משולב · מפרט + PDF</p>
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
                />
              </label>
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

      <div className="quotes-grid">
        {preview.length === 0 ? (
          <p className="empty">אין הצעות עדיין. צור הצעת סיכום לאנשים חדשים.</p>
        ) : (
          preview.map((q) => {
            const rows = buildMonthSchedule(q);
            const open = expandedId === q.id;
            const canEdit = q.status !== "converted";
            return (
              <article key={q.id} className="quote-card">
                <header>
                  <h2>{q.prospect_name}</h2>
                  <span className={`badge badge--${q.status}`}>{statusLabel(q.status)}</span>
                </header>
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
                  <div>
                    <dt>סה״כ רווח בסיום המסלול</dt>
                    <dd>{formatMoney(q.total_investor_payout)}</dd>
                  </div>
                  <div>
                    <dt>קרן + רווח בסיום</dt>
                    <dd>{formatMoney(q.principal + q.total_investor_payout)}</dd>
                  </div>
                </dl>

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
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={pdfBusyId === q.id}
                    onClick={() => exportPdf(q)}
                  >
                    {pdfBusyId === q.id ? "מכינים PDF..." : "הורדת PDF"}
                  </button>
                  {canEdit ? (
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
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => convert(q.id, q.prospect_name)}
                      >
                        הכנס כמשקיע חדש
                      </button>
                    </>
                  ) : (
                    <p className="muted">כבר הומר למשקיע #{q.converted_investor_id}</p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
