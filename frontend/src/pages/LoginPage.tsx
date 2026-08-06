import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** מונע מילוי אוטומטי של הדפדפן (Chrome ממלא ערכים שמורים גם כשה-state ריק). */
function useBlockAutofill(ref: React.RefObject<HTMLInputElement | null>, setValue: (v: string) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const wipe = () => {
      if (document.activeElement === el) return;
      if (el.value) {
        el.value = "";
        setValue("");
      }
    };

    wipe();
    const timers = [50, 150, 400, 800, 1500].map((ms) => window.setTimeout(wipe, ms));
    el.addEventListener("animationstart", wipe);

    return () => {
      timers.forEach(clearTimeout);
      el.removeEventListener("animationstart", wipe);
    };
  }, [ref, setValue]);
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockUser, setUnlockUser] = useState(false);
  const [unlockPass, setUnlockPass] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useBlockAutofill(userRef, setUsername);
  useBlockAutofill(passRef, setPassword);

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
        <div className="state">טוען...</div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <p className="auth-card__eyebrow">כניסה למערכת</p>
        <h1 className="auth-card__brand">תזרים</h1>
        <p className="muted">הזן את פרטי הכניסה שלך כדי להמשיך.</p>

        <form className="form" onSubmit={onSubmit} autoComplete="off">
          <label>
            שם משתמש
            <input
              ref={userRef}
              type="text"
              name="tazrim-login-id"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              readOnly={!unlockUser}
              value={username}
              onFocus={() => setUnlockUser(true)}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            סיסמה
            <input
              ref={passRef}
              type="password"
              name="tazrim-login-secret"
              autoComplete="new-password"
              required
              readOnly={!unlockPass}
              value={password}
              onFocus={() => setUnlockPass(true)}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "מתחבר..." : "התחבר"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">שכחתי סיסמה</Link>
        </div>
      </div>
    </div>
  );
}
