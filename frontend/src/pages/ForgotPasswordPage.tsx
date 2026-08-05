import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

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

export function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockUser, setUnlockUser] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);

  useBlockAutofill(userRef, setUsername);

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
              type="text"
              name="tazrim-reset-id"
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
            הערה למנהל (אופציונלי)
            <input
              type="text"
              name="tazrim-reset-note"
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
