import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

export function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);

  // Always start empty; strip any browser autofill (e.g. saved "bar").
  useEffect(() => {
    setUsername("");
    const el = userRef.current;
    if (el) el.value = "";
    const wipe = () => {
      if (!el || document.activeElement === el) return;
      el.value = "";
      setUsername("");
    };
    const timers = [0, 50, 100, 250, 500, 1000, 2000].map((ms) =>
      window.setTimeout(wipe, ms),
    );
    el?.addEventListener("animationstart", wipe);
    setReady(true);
    return () => {
      timers.forEach(clearTimeout);
      el?.removeEventListener("animationstart", wipe);
    };
  }, []);

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

        <form className="form" onSubmit={onSubmit} autoComplete="off">
          <label>
            שם משתמש
            <input
              ref={userRef}
              key={ready ? "user-ready" : "user-boot"}
              type="search"
              name="tazrim_reset_account"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              readOnly={!ready}
              value={username}
              onFocus={(e) => {
                e.currentTarget.readOnly = false;
              }}
              onChange={(e) => setUsername(e.target.value)}
              placeholder=""
            />
          </label>
          <label>
            הערה למנהל (אופציונלי)
            <input
              type="text"
              name="tazrim_reset_note"
              autoComplete="off"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="למשל: שכחתי את הסיסמה"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="toast">{message}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy || !username.trim()}>
            {busy ? "שולח..." : "שלח בקשה למנהל"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">חזרה להתחברות</Link>
        </div>
      </div>
    </div>
  );
}
