import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "התחברות נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <p className="hero__eyebrow">גישה למשתמשים רשומים בלבד</p>
        <h1 className="auth-card__brand">התחברות</h1>
        <p className="muted">התחברות עם שם משתמש וסיסמה — בלי תלות במייל.</p>

        <form className="form" onSubmit={onSubmit} autoComplete="off">
          <label>
            שם משתמש
            <input
              type="text"
              name="tazrim_username"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder=""
            />
          </label>
          <PasswordField
            label="סיסמה"
            name="tazrim_password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "מתחבר..." : "התחברות"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">שכחתי סיסמה — בקשה למנהל</Link>
        </div>
        <p className="hint">
          אין איפוס סיסמה עצמי. רק המנהל יכול להגדיר או לאשר סיסמה חדשה.
        </p>
      </div>
    </div>
  );
}
