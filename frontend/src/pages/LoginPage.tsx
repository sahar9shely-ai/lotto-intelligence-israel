import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
        <div className="atmosphere" aria-hidden="true" />
        <div className="state state--loading">טוען...</div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <p className="auth-card__eyebrow">ברוכים הבאים</p>
        <h1 className="auth-card__brand">תזרים</h1>
        <p className="auth-card__welcome">
          מערכת ניהול השקעות ותזרים — פשוט, ברור ומעודכן.
        </p>
        <p className="muted">הזינו את שם המשתמש והסיסמה שקיבלתם מהמנהל.</p>

        <form className="form" onSubmit={onSubmit} autoComplete="on">
          <label>
            שם משתמש
            <input
              type="text"
              name="username"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            סיסמה
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
            {busy ? "מתחבר..." : "כניסה למערכת"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">שכחתי סיסמה</Link>
        </div>
      </div>
    </div>
  );
}
