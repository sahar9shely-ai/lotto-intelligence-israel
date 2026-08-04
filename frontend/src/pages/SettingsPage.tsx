import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate } from "../utils/format";

export function SettingsPage() {
  const { data, error, loading, reload } = useAsync(() => api.settings(), []);
  const { data: users, reload: reloadUsers } = useAsync(() => api.users(), []);
  const { data: outbox, reload: reloadOutbox } = useAsync(() => api.emailOutbox(), []);
  const [message, setMessage] = useState<string | null>(null);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.updateSettings({
      default_monthly_rate_percent: Number(fd.get("default_monthly_rate_percent") || 0),
      default_manager_fee_percent: Number(fd.get("default_manager_fee_percent") || 0),
      default_duration_months: Number(fd.get("default_duration_months") || 12),
      manager_display_name: String(fd.get("manager_display_name") || "מנהלת"),
      currency_symbol: "₪",
    });
    setMessage("ההגדרות נשמרו — ישמשו כברירת מחדל למסלולים והצעות חדשים");
    reload();
  }

  async function onUpdateEmail(userId: number, email: string) {
    await api.updateUserEmail(userId, email);
    setMessage("המייל עודכן ונשלחה הזמנה חדשה להגדרת סיסמה");
    reloadUsers();
    reloadOutbox();
  }

  if (loading) return <div className="state">טוען הגדרות...</div>;
  if (error || !data)
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
          <h1>הגדרות גלובליות</h1>
          <p className="muted">משתמשים, מיילים וברירות מחדל</p>
        </div>
      </div>

      {message ? <p className="toast">{message}</p> : null}

      <Panel title="משתמשי המערכת" subtitle="כל משקיע נכנס רק לחשבון שלו · כניסה ראשונה באיפוס מהמייל">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>שם</th>
                <th>מייל</th>
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.investor_name}
                    {u.is_manager ? " · מנהלת" : ""}
                  </td>
                  <td>
                    <form
                      className="inline-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        await onUpdateEmail(u.id, String(fd.get("email") || ""));
                      }}
                    >
                      <input name="email" type="email" defaultValue={u.email} required />
                      <button type="submit" className="btn btn--small">
                        עדכני
                      </button>
                    </form>
                  </td>
                  <td>
                    {u.has_password ? "סיסמה הוגדרה" : "ממתין לאיפוס ראשון"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={async () => {
                        const res = await api.resendInvite(u.id);
                        setMessage(res.message);
                        reloadOutbox();
                      }}
                    >
                      שלחי הזמנה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="אחוזים ומשך"
        subtitle="לא משנים מסלולים קיימים אוטומטית — רק ערכי פתיחה"
      >
        <form className="form" onSubmit={onSave}>
          <div className="form__grid">
            <label>
              שם המנהלת
              <input
                name="manager_display_name"
                defaultValue={data.manager_display_name}
                required
              />
            </label>
            <label>
              אחוז חודשי ברירת מחדל למשקיע
              <input
                name="default_monthly_rate_percent"
                type="number"
                min="0"
                step="0.01"
                defaultValue={data.default_monthly_rate_percent}
              />
            </label>
            <label>
              אחוז עמלת ניהול ברירת מחדל
              <input
                name="default_manager_fee_percent"
                type="number"
                min="0"
                step="0.01"
                defaultValue={data.default_manager_fee_percent}
              />
            </label>
            <label>
              משך מסלול ברירת מחדל
              <select name="default_duration_months" defaultValue={data.default_duration_months}>
                {[12, 14, 18, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m} חודשים
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="btn btn--primary">
            שמרי הגדרות
          </button>
        </form>
      </Panel>

      <Panel
        title="תיבת מיילים (פיתוח)"
        subtitle="כשאין SMTP — המיילים נשמרים כאן כולל קישורי איפוס"
        action={
          <button type="button" className="btn btn--small btn--ghost" onClick={reloadOutbox}>
            רענון
          </button>
        }
      >
        {(outbox ?? []).length === 0 ? (
          <p className="empty">אין מיילים עדיין.</p>
        ) : (
          <ul className="list">
            {(outbox ?? []).slice(0, 12).map((mail) => (
              <li key={mail.id} className="list__row email-row">
                <div>
                  <strong>
                    {mail.kind} · {mail.to_email}
                  </strong>
                  <span className="muted">
                    {mail.subject} · {formatDate(mail.created_at)}
                  </span>
                  <pre className="email-body">{mail.body}</pre>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
