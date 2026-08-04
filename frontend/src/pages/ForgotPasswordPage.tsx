import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

function toAppLink(link: string): string {
  try {
    const url = new URL(link, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return link;
  }
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setResetLink(null);
    setDelivered(null);
    try {
      const res = await api.forgotPassword(email.trim());
      setMessage(res.message);
      setDelivered(res.email_delivered ?? null);
      if (res.reset_link) setResetLink(toAppLink(res.reset_link));
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
          הזיני את המייל שלך. אם שירות המייל לא מחובר — יופיע כאן קישור ישיר להגדרת סיסמה.
        </p>
        <form className="form" onSubmit={onSubmit}>
          <label>
            מייל
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sahar9shely@gmail.com"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="toast">{message}</p> : null}
          {resetLink ? (
            <div className="reset-box">
              <p className="hint">
                {delivered
                  ? "נשלח גם למייל. אפשר גם לפתוח ישירות:"
                  : "לחצי על הקישור כדי להגדיר סיסמה עכשיו:"}
              </p>
              <a className="btn btn--primary" href={resetLink}>
                הגדרת סיסמה
              </a>
              <code className="reset-link-text">{window.location.origin + resetLink}</code>
            </div>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "שולח..." : "שלחי קישור"}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">חזרה להתחברות</Link>
        </div>
      </div>
    </div>
  );
}
