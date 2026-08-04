import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

function extractResetLink(errMessage: string): string | null {
  try {
    const parsed = JSON.parse(errMessage) as { reset_link?: string; message?: string };
    return parsed.reset_link ?? null;
  } catch {
    return null;
  }
}

function extractMessage(errMessage: string): string {
  try {
    const parsed = JSON.parse(errMessage) as { message?: string };
    return parsed.message || errMessage;
  } catch {
    return errMessage;
  }
}

function toAppLink(link: string): string {
  try {
    const url = new URL(link, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return link;
  }
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResetLink(null);
    try {
      await login(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "התחברות נכשלה";
      const link = extractResetLink(raw);
      setError(extractMessage(raw));
      if (link) setResetLink(toAppLink(link));
      // If first login blocked, also try forgot endpoint for a fresh link
      if (!link && raw.includes("כניסה ראשונה")) {
        try {
          const res = await api.forgotPassword(email.trim());
          if (res.reset_link) setResetLink(toAppLink(res.reset_link));
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <p className="hero__eyebrow">גישה למשתמשים רשומים בלבד</p>
        <h1 className="auth-card__brand">תזרים</h1>
        <p className="muted">התחברות אישית — כל משתמש רואה רק את הנתונים שלו.</p>

        <form className="form" onSubmit={onSubmit}>
          <label>
            מייל
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
            />
          </label>
          <label>
            סיסמה
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {resetLink ? (
            <div className="reset-box">
              <p className="hint">כניסה ראשונה — לחצי להגדרת סיסמה:</p>
              <a className="btn btn--primary" href={resetLink}>
                הגדרת סיסמה עכשיו
              </a>
            </div>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "מתחבר..." : "התחברות"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">שכחתי סיסמה / כניסה ראשונה</Link>
        </div>
        <p className="hint">
          בכניסה הראשונה מגדירים סיסמה מהקישור. אין כניסת אורחים.
        </p>
      </div>
    </div>
  );
}
