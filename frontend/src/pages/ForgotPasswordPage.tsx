import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.forgotPassword(email.trim());
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שליחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <h1 className="auth-card__brand">שחזור סיסמה</h1>
        <p className="muted">
          הזיני את המייל שלך. נשלח קישור להגדרת סיסמה חדשה (גם לכניסה ראשונה).
        </p>
        <form className="form" onSubmit={onSubmit}>
          <label>
            מייל
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="toast">{message}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "שולח..." : "שלחי קישור למייל"}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">חזרה להתחברות</Link>
        </div>
      </div>
    </div>
  );
}
