import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

export function SettingsPage() {
  const { data, error, loading, reload } = useAsync(() => api.settings(), []);
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
          <p className="muted">ברירות מחדל שניתן לתמרן בכל רגע</p>
        </div>
      </div>

      {message ? <p className="toast">{message}</p> : null}

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
          <p className="hint">
            עמלת הניהול היא תוספת נפרדת מעל התשואה למשקיע. אפשר לערוך גם בכל מסלול בנפרד.
          </p>
          <button type="submit" className="btn btn--primary">
            שמרי הגדרות
          </button>
        </form>
      </Panel>

      <Panel title="גישה מכל טלפון" subtitle="PWA · קישור אחד">
        <ol className="steps">
          <li>הריצי את השרת והפתחי את הכתובת בדפדפן של הטלפון.</li>
          <li>אפשר להוסיף למסך הבית לשמירה כאייקון.</li>
          <li>הנתונים נשמרים בשרת — אותו מצב מכל מכשיר שמחובר.</li>
        </ol>
      </Panel>
    </div>
  );
}
