import { FormEvent, useCallback, useState } from "react";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { Toast } from "../components/Toast";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { AuthUser, PasswordResetRequestItem } from "../types/auth";
import { formatDate } from "../utils/format";

export function UsersPage() {
  const { data: users, error, loading, reload } = useAsync(() => api.users(), []);
  const {
    data: resetRequests,
    reload: reloadRequests,
  } = useAsync(() => api.passwordResetRequests(true), []);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [fulfillTarget, setFulfillTarget] = useState<PasswordResetRequestItem | null>(null);
  const [fulfillPassword, setFulfillPassword] = useState("");
  const clearMessage = useCallback(() => setMessage(null), []);

  async function saveUser(user: AuthUser, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.updateUser(user.id, {
        investor_name: String(fd.get("investor_name") || "").trim(),
        username: String(fd.get("username") || "").trim(),
        email: String(fd.get("email") || "").trim() || null,
        role: String(fd.get("role") || "investor"),
        is_active: String(fd.get("is_active") || "true") === "true",
      });
      const newPassword = String(fd.get("new_password") || "");
      if (newPassword) {
        await api.setUserPassword(user.id, newPassword);
      }
      setMessage(
        newPassword
          ? "המשתמש עודכן והסיסמה הוגדרה על ידך."
          : "המשתמש עודכן.",
      );
      reload();
      reloadRequests();
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
        username: String(fd.get("username") || "").trim(),
        password: String(fd.get("password") || ""),
        email: String(fd.get("email") || "").trim() || undefined,
        role: String(fd.get("role") || "investor"),
        phone: String(fd.get("phone") || "") || undefined,
      });
      setShowCreate(false);
      setMessage("משתמש חדש נוצר עם שם משתמש וסיסמה.");
      reload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "יצירה נכשלה");
    }
  }

  async function confirmFulfill(e: FormEvent) {
    e.preventDefault();
    if (!fulfillTarget) return;
    if (fulfillPassword.length < 8) {
      setErrorMsg("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    try {
      await api.fulfillPasswordReset(fulfillTarget.id, fulfillPassword);
      setMessage(`הסיסמה של ${fulfillTarget.display_name} עודכנה.`);
      setFulfillTarget(null);
      setFulfillPassword("");
      reload();
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "עדכון סיסמה נכשל");
    }
  }

  async function rejectRequest(req: PasswordResetRequestItem) {
    if (!window.confirm(`לדחות את בקשת האיפוס של ${req.display_name}?`)) return;
    try {
      await api.rejectPasswordReset(req.id);
      setMessage(`הבקשה של ${req.display_name} נדחתה.`);
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "דחייה נכשלה");
    }
  }

  if (loading) return <div className="state">טוען משתמשים...</div>;
  if (error)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={reload}>
          נסה שוב
        </button>
      </div>
    );

  const pendingUsers = (users ?? []).filter((u) => !u.has_password);
  const pendingResets = resetRequests ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>משתמשים והרשאות</h1>
          <p className="muted">
            התחברות בשם משתמש וסיסמה · רק אתה מגדיר/מאשר איפוס סיסמה
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
          משתמש חדש
        </button>
      </div>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}
      {errorMsg ? <p className="form-error">{errorMsg}</p> : null}

      {pendingResets.length > 0 ? (
        <Panel
          title="בקשות איפוס סיסמה"
          subtitle={`${pendingResets.length} ממתינות לאישור שלך`}
        >
          <ul className="list">
            {pendingResets.map((req) => (
              <li key={req.id} className="list__row">
                <div>
                  <strong>
                    {req.display_name} · {req.username}
                  </strong>
                  <span className="muted">
                    {formatDate(req.created_at)}
                    {req.note ? ` · ${req.note}` : ""}
                  </span>
                </div>
                <div className="page-head__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => {
                      setFulfillPassword("");
                      setFulfillTarget(req);
                    }}
                  >
                    אשר והגדר סיסמה
                  </button>
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => rejectRequest(req)}>
                    דחה
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {pendingUsers.length > 0 ? (
        <Panel
          title="ממתינים להגדרת סיסמה"
          subtitle={`${pendingUsers.length} משתמשים בלי סיסמה פעילה`}
        >
          <ul className="list">
            {pendingUsers.map((u) => (
              <li key={u.id} className="list__row">
                <div>
                  <strong>
                    {u.investor_name} · {u.username}
                  </strong>
                  <span className="muted">הגדר סיסמה בטופס למטה</span>
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
            u.has_password
              ? `שם משתמש: ${u.username} · יש גישה פעילה`
              : `שם משתמש: ${u.username} · ממתין לסיסמה מהמנהל`
          }
        >
          <form className="form" onSubmit={(e) => saveUser(u, e)}>
            <div className="form__grid">
              <label>
                שם
                <input name="investor_name" defaultValue={u.investor_name} required />
              </label>
              <label>
                שם משתמש
                <input name="username" defaultValue={u.username} required />
              </label>
              <label>
                מייל (אופציונלי ליצירת קשר)
                <input
                  name="email"
                  type="email"
                  defaultValue={u.email && !u.email.endsWith("@local.tazrim") ? u.email : ""}
                  placeholder="אופציונלי"
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
              <PasswordField
                label="סיסמה חדשה (רק אתה מגדיר)"
                name="new_password"
                minLength={8}
                autoComplete="new-password"
                placeholder={u.has_password ? "השאר ריק כדי לא לשנות" : "חובה להגדיר"}
              />
            </div>
            <div className="page-head__actions">
              <button type="submit" className="btn btn--primary">
                שמור
              </button>
            </div>
            <p className="hint">
              כניסה אחרונה: {u.last_login_at ? formatDate(u.last_login_at) : "עדיין לא התחבר"}
            </p>
          </form>
        </Panel>
      ))}

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
                שם משתמש
                <input name="username" required placeholder="revital" autoComplete="off" />
              </label>
              <PasswordField
                label="סיסמה התחלתית"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <label>
                מייל (אופציונלי)
                <input name="email" type="email" placeholder="אופציונלי" />
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
              <button type="submit" className="btn btn--primary">
                צור משתמש
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {fulfillTarget ? (
        <div className="modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => {
              setFulfillTarget(null);
              setFulfillPassword("");
            }}
          />
          <div className="modal__sheet">
            <header className="modal__head">
              <h2>סיסמה חדשה ל-{fulfillTarget.display_name}</h2>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setFulfillTarget(null);
                  setFulfillPassword("");
                }}
              >
                סגרי
              </button>
            </header>
            <form className="form" onSubmit={confirmFulfill}>
              <p className="muted">שם משתמש: {fulfillTarget.username}</p>
              <PasswordField
                label="סיסמה חדשה"
                name="fulfill_password"
                required
                minLength={8}
                autoComplete="new-password"
                value={fulfillPassword}
                onChange={(e) => setFulfillPassword(e.target.value)}
              />
              <button type="submit" className="btn btn--primary">
                אשר ושמור סיסמה
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
