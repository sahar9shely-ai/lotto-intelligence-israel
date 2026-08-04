import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("sahar9shely@gmail.com");
  const [message, setMessage] = useState<string | null>(null);
  const [resetPath, setResetPath] = useState<string | null>(null);
  const [fullLink, setFullLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepareLink(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setResetPath(null);
    setFullLink(null);
    try {
      const res = await api.forgotPassword(email.trim());
      const link = res.reset_link || "";
      if (!link) {
        setMessage(res.message);
        setError("לא התקבל קישור מהשרת. נסי שוב.");
        return;
      }
      const url = new URL(link, window.location.origin);
      const path = `${url.pathname}${url.search}`;
      const absolute = `${window.location.origin}${path}`;
      setResetPath(path);
      setFullLink(absolute);
      setMessage(
        res.email_delivered
          ? "נשלח גם למייל. אפשר להמשיך מכאן:"
          : "אין שליחה ל-Gmail כרגע. לחצי על הכפתור הירוק להגדרת סיסמה:",
      );
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
        <h1 className="auth-card__brand">הגדרת סיסמה</h1>
        <p className="muted">
          חשוב: המיילים <strong>לא נשלחים ל-Gmail</strong> עד שתחברו SMTP. בינתיים מגדירים
          סיסמה עם קישור שמופיע כאן במסך.
        </p>

        <div className="form">
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

          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !email.trim()}
            onClick={() => void prepareLink()}
          >
            {busy ? "מכין קישור..." : "הכיני קישור להגדרת סיסמה"}
          </button>

          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="toast">{message}</p> : null}

          {resetPath && fullLink ? (
            <div className="reset-box">
              <strong>הקישור מוכן</strong>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate(resetPath)}
              >
                המשך להגדרת סיסמה
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fullLink);
                    setMessage("הקישור הועתק ללוח");
                  } catch {
                    setMessage(fullLink);
                  }
                }}
              >
                העתקת קישור
              </button>
              <code className="reset-link-text">{fullLink}</code>
            </div>
          ) : null}
        </div>

        <div className="auth-links">
          <Link to="/login">חזרה להתחברות</Link>
        </div>
      </div>
    </div>
  );
}
