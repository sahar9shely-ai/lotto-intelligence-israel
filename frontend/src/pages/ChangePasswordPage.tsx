import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const forced = Boolean(user?.must_reset_password);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("שתי הסיסמאות החדשות אינן זהות");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changeOwnPassword(currentPassword, newPassword);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "החלפת הסיסמה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="atmosphere" aria-hidden="true" />
      <div className="auth-card">
        <p className="auth-card__eyebrow">{forced ? "צעד קצר לפני הכניסה" : "התיק הפרטי שלך"}</p>
        <h1 className="auth-card__brand">תזרים</h1>
        <p className="auth-card__welcome">
          {forced
            ? "הסיסמה שקיבלת היא זמנית. בחרו סיסמה אישית — רק אתם תדעו אותה."
            : "אפשר להחליף את הסיסמה בכל רגע. הסיסמה החדשה נשארת אצלך בלבד."}
        </p>

        <form className="form auth-card__form" onSubmit={onSubmit} autoComplete="on">
          <PasswordField
            label="הסיסמה הנוכחית"
            name="current-password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <PasswordField
            label="סיסמה חדשה"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <PasswordField
            label="אימות סיסמה חדשה"
            name="confirm-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
            {busy ? "שומרים..." : "שמירת סיסמה חדשה"}
          </button>
        </form>

        <div className="auth-links">
          {forced ? (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              יציאה
            </button>
          ) : (
            <Link to="/">חזרה לתיק</Link>
          )}
        </div>
      </div>
    </div>
  );
}
