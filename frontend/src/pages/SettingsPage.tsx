import { FormEvent, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { Toast } from "../components/Toast";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

export function SettingsPage() {
  const { data, error, loading, reload } = useAsync(() => api.settings(), []);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clearMessage = useCallback(() => setMessage(null), []);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.updateSettings({
      default_monthly_rate_percent: Number(fd.get("default_monthly_rate_percent") || 0),
      default_manager_fee_percent: Number(fd.get("default_manager_fee_percent") || 0),
      default_duration_months: Number(fd.get("default_duration_months") || 12),
      manager_display_name: String(fd.get("manager_display_name") || "סהר"),
      currency_symbol: "₪",
      site_updating: fd.get("site_updating") === "on",
      site_updating_message: String(
        fd.get("site_updating_message") ||
          "האתר בעדכון כרגע — ייתכנו שינויים זמניים בתצוגה.",
      ),
      slack_webhook_url:
        data?.slack_webhook_url != null ? data.slack_webhook_url : undefined,
    });
    setMessage("ההגדרות נשמרו");
    reload();
  }

  async function onSaveSlack(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.updateSettings({
      slack_webhook_url: String(fd.get("slack_webhook_url") || "").trim() || null,
    });
    setMessage("חיבור Slack נשמר");
    reload();
  }

  async function toggleUpdating(next: boolean) {
    setBusy(true);
    try {
      await api.updateSettings({ site_updating: next });
      setMessage(next ? "הודעת עדכון מוצגת לכל המחוברים" : "הודעת העדכון כובתה");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="state">טוען הגדרות...</div>;
  if (error || !data)
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
          <h1>הגדרות גלובליות</h1>
          <p className="muted">ברירות מחדל למסלולים · הודעת עדכון למשתמשים פעילים</p>
        </div>
        <Link className="btn btn--primary" to="/users">
          משתמשים והרשאות
        </Link>
      </div>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}

      <Panel
        title="האתר בעדכון"
        subtitle="כשמופעל — כל משתמש מחובר רואה באנר בראש האתר"
      >
        <p className="hint">
          {data.site_updating
            ? "כרגע מוצגת הודעת עדכון לכל מי שמחובר."
            : "כרגע אין הודעת עדכון. הפעילו כשמבצעים שינויים באתר."}
        </p>
        <div className="page-head__actions">
          {data.site_updating ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => toggleUpdating(false)}
            >
              {busy ? "מכבים..." : "סיום עדכון"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => toggleUpdating(true)}
            >
              {busy ? "מפעילים..." : "הצג הודעת עדכון"}
            </button>
          )}
        </div>
      </Panel>

      <Panel title="גישה למשתמשים" subtitle="מיילים והרשאות מתנהלים באפליקציה">
        <p className="hint">
          לכל משקיע חובה מייל אמיתי כדי לקבל גישה. עדכון מייל, בחירת הרשאה (משקיע /
          מנהל) ושליחת הזמנה — הכל במסך{" "}
          <Link className="text-link" to="/users">
            משתמשים והרשאות
          </Link>
          .
        </p>
      </Panel>

      <Panel
        title="צ'אט עבודה · Slack"
        subtitle="פתיחה מהירה של תזרים מהערוץ — כפתור אחד"
      >
        <p className="hint">
          צרו Incoming Webhook ב-Slack (Apps → Incoming Webhooks), הדביקו כאן, ושמרו.
          אחר כך אפשר ללחוץ «שלח ל-Slack» בסרגל העליון — או שהמערכת תשלח אוטומטית כשהקישור הציבורי מתחלף.
        </p>
        <form className="form" onSubmit={onSaveSlack}>
          <label>
            Slack Webhook URL
            <input
              name="slack_webhook_url"
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              defaultValue={data.slack_webhook_url ?? ""}
              dir="ltr"
            />
          </label>
          <button type="submit" className="btn btn--primary">
            שמור חיבור Slack
          </button>
        </form>
      </Panel>

      <Panel
        title="אחוזים ומשך"
        subtitle="לא משנים מסלולים קיימים אוטומטית — רק ערכי פתיחה"
      >
        <form className="form" onSubmit={onSave}>
          <div className="form__grid">
            <label>
              שם המנהל
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                name="site_updating"
                defaultChecked={data.site_updating}
              />
              הצג הודעת «האתר בעדכון» למשתמשים מחוברים
            </label>
            <label>
              טקסט הודעת העדכון
              <input
                name="site_updating_message"
                defaultValue={data.site_updating_message}
              />
            </label>
          </div>
          <button type="submit" className="btn btn--primary">
            שמור הגדרות
          </button>
        </form>
      </Panel>
    </div>
  );
}
