import { FormEvent, useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Quote } from "../types/investments";
import { buildMonthSchedule, downloadQuotePdf } from "../utils/quotePdf";
import { formatMoney, formatPercent, statusLabel, todayISO } from "../utils/format";

export function QuotesPage() {
  const { data: settings } = useAsync(() => api.settings(), []);
  const { data, error, loading, reload } = useAsync(() => api.quotes(), []);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<number | null>(null);

  const preview = useMemo(() => data ?? [], [data]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.createQuote({
      prospect_name: String(fd.get("prospect_name") || "").trim(),
      principal: Number(fd.get("principal") || 0),
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
      // Management fee stays internal/default — not shown on investor-facing quote.
      manager_fee_percent: Number(
        settings?.default_manager_fee_percent ?? 0,
      ),
      duration_months: Number(fd.get("duration_months") || 12),
      notes: String(fd.get("notes") || "") || undefined,
    });
    setShowForm(false);
    setMessage("הצעת סיכום נוצרה");
    reload();
  }

  async function convert(id: number, name: string) {
    const start = window.prompt(`תאריך התחלה ל-${name} (YYYY-MM-DD)`, todayISO());
    if (!start) return;
    const email = window.prompt(`מייל לגישה של ${name} (חובה)`, "")?.trim();
    if (!email) {
      setMessage("לא ניתן להמיר בלי מייל — אפשר גם ליצור משתמש ממסך משתמשים והרשאות");
      return;
    }
    await api.convertQuote(id, { start_date: start, email, send_invite: true });
    setMessage(`${name} הומר למשקיע חדש — נשלחה הזמנה ל-${email}`);
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
          נסי שוב
        </button>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>הצעות למשקיעים חדשים</h1>
          <p className="muted">מפרט חודשי + סה״כ רווח · אפשרות להורדת PDF</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setShowForm(true)}>
          הצעה חדשה
        </button>
      </div>

      {message ? <p className="toast">{message}</p> : null}

      {showForm ? (
        <Panel title="סיכום הצעה" subtitle="לחישוב לפי קרן ואחוז קבוע למשקיע">
          <form className="form" onSubmit={onCreate}>
            <div className="form__grid">
              <label>
                שם המועמד/ת
                <input name="prospect_name" required placeholder="שם" />
              </label>
              <label>
                קרן מוצעת (₪)
                <input name="principal" type="number" min="0" step="0.01" required defaultValue={0} />
              </label>
              <label>
                אחוז חודשי
                <input
                  name="monthly_rate_percent"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={settings?.default_monthly_rate_percent ?? 0}
                />
              </label>
              <label>
                משך
                <select name="duration_months" defaultValue={12}>
                  {[12, 14, 18, 24].map((m) => (
                    <option key={m} value={m}>
                      {m} חודשים
                    </option>
                  ))}
                </select>
              </label>
              <label>
                הערות
                <input name="notes" />
              </label>
            </div>
            <div className="page-head__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setShowForm(false)}>
                ביטול
              </button>
              <button type="submit" className="btn btn--primary">
                שמרי הצעה
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <div className="quotes-grid">
        {preview.length === 0 ? (
          <p className="empty">אין הצעות עדיין. צרי הצעת סיכום לאנשים חדשים.</p>
        ) : (
          preview.map((q) => {
            const rows = buildMonthSchedule(q);
            const open = expandedId === q.id;
            return (
              <article key={q.id} className="quote-card">
                <header>
                  <h2>{q.prospect_name}</h2>
                  <span className={`badge badge--${q.status}`}>{statusLabel(q.status)}</span>
                </header>
                <p className="quote-card__lead">
                  קרן {formatMoney(q.principal)} · {formatPercent(q.monthly_rate_percent)} לחודש ·{" "}
                  {q.duration_months} חודשים
                </p>
                <dl className="quote-dl">
                  <div>
                    <dt>רווח חודשי</dt>
                    <dd>{formatMoney(q.monthly_investor_payout, true)}</dd>
                  </div>
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
                          <th>רווח לחודש</th>
                          <th>רווח מצטבר</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.month}>
                            <td>{r.month}</td>
                            <td>{formatMoney(r.profit, true)}</td>
                            <td>{formatMoney(r.cumulative, true)}</td>
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
                  {q.status !== "converted" ? (
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => convert(q.id, q.prospect_name)}
                    >
                      הכניסי כמשקיע חדש
                    </button>
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
