import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ההתחברות נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="atmosphere atmosphere--private" aria-hidden="true" />
        <div className="state state--loading">טוען...</div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere atmosphere--private" aria-hidden="true" />
      <div className="auth-card">
        <p className="auth-card__eyebrow">התיק הפרטי</p>
        <h1 className="auth-card__brand">תזרים</h1>
        <p className="auth-card__welcome">
          שלום. כאן רואים את הקרן, התשלום הבא ומה ששולם — בשקט ובבהירות.
        </p>

        <form className="form auth-card__form" onSubmit={onSubmit} autoComplete="on">
          <label>
            שם משתמש
            <input
              type="text"
              name="username"
              inputMode="text"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <PasswordField
            label="סיסמה"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
            {busy ? "נכנס..." : "כניסה לתיק הפרטי"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">שכחתי סיסמה</Link>
        </div>
      </div>
    </div>
  );
}
