import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

export function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.requestPasswordReset(
        username.trim(),
        note.trim() || undefined,
      );
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שליחת הבקשה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <p className="hero__eyebrow">איפוס סיסמה</p>
        <h1 className="auth-card__brand">תזרים</h1>
        <p className="muted">
          הלקוח לא מאפס סיסמה לבד. שולחים בקשה למנהל — רק הוא מגדיר סיסמה חדשה.
        </p>

        <form className="form" onSubmit={onSubmit}>
          <label>
            שם משתמש
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="bar"
            />
          </label>
          <label>
            הערה למנהל (אופציונלי)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="למשל: שכחתי את הסיסמה"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="toast">{message}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy || !username.trim()}>
            {busy ? "שולח..." : "שלחי בקשה למנהל"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">חזרה להתחברות</Link>
        </div>
      </div>
    </div>
  );
}
