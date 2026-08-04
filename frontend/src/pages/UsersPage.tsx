import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { AuthUser } from "../types/auth";
import { formatDate } from "../utils/format";

export function UsersPage() {
  const { data: users, error, loading, reload } = useAsync(() => api.users(), []);
  const { data: outbox, reload: reloadOutbox } = useAsync(() => api.emailOutbox(), []);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function saveUser(user: AuthUser, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.updateUser(user.id, {
        investor_name: String(fd.get("investor_name") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        role: String(fd.get("role") || "investor"),
        is_active: String(fd.get("is_active") || "true") === "true",
        send_invite: fd.get("send_invite") === "on",
      });
      setMessage("המשתמש עודכן. אם שינית מייל — נשלחה הזמנה להגדרת סיסמה.");
      reload();
      reloadOutbox();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "עדכון נכשל");
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.createAccessUser({
        name: String(fd.get("name") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        role: String(fd.get("role") || "investor"),
        phone: String(fd.get("phone") || "") || undefined,
        send_invite: fd.get("send_invite") === "on",
      });
      setShowCreate(false);
      setMessage("משתמש חדש נוצר. עדכון מייל + הרשאה נשמרו באפליקציה.");
      reload();
      reloadOutbox();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "יצירה נכשלה");
    }
  }

  if (loading) return <div className="state">טוען משתמשים...</div>;
  if (error)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={reload}>
          נסי שוב
        </button>
      </div>
    );

  const pending = (users ?? []).filter((u) => u.email_needs_update || !u.has_password);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>משתמשים והרשאות</h1>
          <p className="muted">
            כאן מעדכנים מייל לכל משתמש ובוחרים הרשאה — בלי צורך לעדכן דרך המפתח
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
          משתמש חדש
        </button>
      </div>

      {message ? <p className="toast">{message}</p> : null}
      {errorMsg ? <p className="form-error">{errorMsg}</p> : null}

      {pending.length > 0 ? (
        <Panel
          title="ממתינים להשלמת גישה"
          subtitle={`${pending.length} משתמשים צריכים מייל אמיתי או הגדרת סיסמה`}
        >
          <ul className="list">
            {pending.map((u) => (
              <li key={u.id} className="list__row">
                <div>
                  <strong>{u.investor_name}</strong>
                  <span className="muted">
                    {u.email_needs_update ? "חסר מייל אמיתי · " : ""}
                    {u.has_password ? "יש סיסמה" : "ממתין לאיפוס מהמייל"}
                  </span>
                </div>
                <span className="badge badge--scheduled">
                  {u.role === "manager" ? "מנהל" : "משקיע"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {(users ?? []).map((u) => (
        <Panel
          key={u.id}
          title={u.investor_name}
          subtitle={
            u.email_needs_update
              ? "חובה לעדכן מייל אמיתי כדי לאפשר גישה"
              : u.has_password
                ? "יש גישה פעילה"
                : "ממתין להגדרת סיסמה מהמייל"
          }
        >
          <form className="form" onSubmit={(e) => saveUser(u, e)}>
            <div className="form__grid">
              <label>
                שם
                <input name="investor_name" defaultValue={u.investor_name} required />
              </label>
              <label>
                מייל לגישה
                <input
                  name="email"
                  type="email"
                  defaultValue={u.email_needs_update ? "" : u.email}
                  placeholder={u.email_needs_update ? u.email : "name@gmail.com"}
                  required
                />
              </label>
              <label>
                הרשאה
                <select name="role" defaultValue={u.role}>
                  <option value="investor">משקיע — רואה רק את שלו</option>
                  <option value="manager">מנהל — גישה מלאה + התראות</option>
                </select>
              </label>
              <label>
                סטטוס חשבון
                <select name="is_active" defaultValue={u.is_active === false ? "false" : "true"}>
                  <option value="true">פעיל</option>
                  <option value="false">מושבת</option>
                </select>
              </label>
            </div>
            <label className="check-row">
              <input name="send_invite" type="checkbox" defaultChecked={u.email_needs_update || !u.has_password} />
              שלחי הזמנה להגדרת סיסמה אחרי שמירת מייל חדש
            </label>
            <div className="page-head__actions">
              <button type="submit" className="btn btn--primary">
                שמרי
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={Boolean(u.email_needs_update)}
                onClick={async () => {
                  try {
                    const res = await api.resendInvite(u.id);
                    setMessage(
                      res.reset_link && !res.email_delivered
                        ? `${res.message} — קישור: ${res.reset_link}`
                        : res.message,
                    );
                    reloadOutbox();
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : "שליחה נכשלה");
                  }
                }}
              >
                שלחי הזמנה שוב
              </button>
            </div>
            <p className="hint">
              כניסה אחרונה: {u.last_login_at ? formatDate(u.last_login_at) : "עדיין לא התחבר/ה"}
            </p>
          </form>
        </Panel>
      ))}

      <Panel
        title="תיבת מיילים שנשלחו"
        subtitle="כשאין SMTP — הקישורים מופיעים כאן"
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
            {(outbox ?? []).slice(0, 10).map((mail) => (
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

      {showCreate ? (
        <div className="modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => setShowCreate(false)}
          />
          <div className="modal__sheet">
            <header className="modal__head">
              <h2>משתמש חדש</h2>
              <button type="button" className="btn btn--ghost" onClick={() => setShowCreate(false)}>
                סגרי
              </button>
            </header>
            <form className="form" onSubmit={onCreate}>
              <label>
                שם
                <input name="name" required placeholder="שם המשקיע" />
              </label>
              <label>
                מייל (חובה לגישה)
                <input name="email" type="email" required placeholder="name@gmail.com" />
              </label>
              <label>
                הרשאה
                <select name="role" defaultValue="investor">
                  <option value="investor">משקיע — רואה רק את שלו</option>
                  <option value="manager">מנהל — גישה מלאה</option>
                </select>
              </label>
              <label>
                טלפון
                <input name="phone" />
              </label>
              <label className="check-row">
                <input name="send_invite" type="checkbox" defaultChecked />
                שלחי מייל להגדרת סיסמה עכשיו
              </label>
              <button type="submit" className="btn btn--primary">
                צרי משתמש
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
