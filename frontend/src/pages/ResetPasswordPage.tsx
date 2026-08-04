import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("חסר קישור תקין מהמייל");
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword(token, password);
      setMessage(res.message);
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "עדכון נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <h1 className="auth-card__brand">הגדרת סיסמה</h1>
        <p className="muted">בחרי סיסמה אישית (לפחות 8 תווים) לפי הקישור שנשלח למייל שלך.</p>
        {!token ? <p className="form-error">הקישור חסר או לא תקין. בקשי מייל חדש.</p> : null}
        <form className="form" onSubmit={onSubmit}>
          <label>
            סיסמה חדשה
            <input
              type="password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            אימות סיסמה
            <input
              type="password"
              minLength={8}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="toast">{message}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy || !token}>
            {busy ? "שומר..." : "שמרי סיסמה"}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/forgot-password">שלחי קישור חדש</Link>
          <Link to="/login">התחברות</Link>
        </div>
      </div>
    </div>
  );
}
