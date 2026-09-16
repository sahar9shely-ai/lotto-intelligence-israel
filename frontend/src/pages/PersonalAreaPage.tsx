import { FormEvent, useCallback, useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidIsraeliPhone(value: string): boolean {
  const raw = value.trim();
  if (!raw) return true;
  if (!/^[0-9+\-\s()]+$/.test(raw)) return false;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9 && digits.startsWith("5")) digits = `0${digits}`;
  const mobile = digits.length === 10 && digits.startsWith("05");
  const landline = digits.length === 9 && digits.startsWith("0") && !digits.startsWith("05");
  return mobile || landline;
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <rect
        x="6"
        y="11"
        width="12"
        height="9"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 11V8.4a3.5 3.5 0 0 1 7 0V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PersonalAreaPage() {
  const { user, refresh } = useAuth();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);

  useEffect(() => {
    setPhone(user?.phone ?? "");
    setEmail(user?.email ?? "");
  }, [user?.phone, user?.email]);

  async function onSaveDetails(e: FormEvent) {
    e.preventDefault();
    const nextPhone = phone.trim();
    const nextEmail = email.trim();
    if (nextPhone && !isValidIsraeliPhone(nextPhone)) {
      setDetailsError("מספר הטלפון אינו תקין");
      return;
    }
    if (nextEmail && !EMAIL_RE.test(nextEmail)) {
      setDetailsError("כתובת המייל לא תקינה");
      return;
    }
    setDetailsBusy(true);
    setDetailsError(null);
    try {
      await api.updateOwnProfile({
        phone: nextPhone || null,
        email: nextEmail || null,
      });
      await refresh();
      setMessage("הפרטים נשמרו");
    } catch (err) {
      const text = err instanceof Error ? err.message : "שמירת הפרטים נכשלה";
      setDetailsError(text);
      setMessage("שמירת הפרטים נכשלה");
    } finally {
      setDetailsBusy(false);
    }
  }

  async function onSavePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError("שתי הסיסמאות החדשות אינן זהות");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("הסיסמה החדשה חייבת להכיל לפחות 8 תווים");
      return;
    }
    setPasswordBusy(true);
    setPasswordError(null);
    try {
      await api.changeOwnPassword(currentPassword, newPassword);
      await refresh();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("הסיסמה עודכנה");
    } catch (err) {
      const text = err instanceof Error ? err.message : "החלפת הסיסמה נכשלה";
      setPasswordError(text);
      setMessage("החלפת הסיסמה נכשלה");
    } finally {
      setPasswordBusy(false);
    }
  }

  const fullName = user?.investor_name || user?.username || "";

  return (
    <div className="page personal-area">
      <Toast message={message} onClear={clearMessage} />
      <header className="page-intro">
        <div>
          <p className="page-intro__eyebrow">החשבון שלי</p>
          <h1 className="page-intro__title">אזור אישי</h1>
          <p className="page-intro__lead">
            כאן מעדכנים טלפון, מייל וסיסמה. השם המלא נשאר קבוע במערכת.
          </p>
        </div>
      </header>

      <Panel title="פרטים אישיים" subtitle="השם נקבע במערכת ולא ניתן לשינוי">
        <form className="form" onSubmit={onSaveDetails} autoComplete="on">
          <label className="locked-field">
            שם מלא
            <span className="locked-field__control">
              <input value={fullName} readOnly disabled aria-readonly="true" />
              <span className="locked-field__icon" title="לא ניתן לעריכה">
                <LockGlyph />
                <span>נעול</span>
              </span>
            </span>
          </label>
          <label>
            טלפון
            <input
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="05X-XXX-XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label>
            מייל
            <input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              placeholder="name@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {detailsError ? <p className="form-error">{detailsError}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={detailsBusy}>
            {detailsBusy ? "שומרים..." : "שמירת פרטים"}
          </button>
        </form>
      </Panel>

      <Panel title="החלפת סיסמה" subtitle="הסיסמה החדשה נשארת אצלך בלבד">
        <form className="form" onSubmit={onSavePassword} autoComplete="on">
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
          {passwordError ? <p className="form-error">{passwordError}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={passwordBusy}>
            {passwordBusy ? "שומרים..." : "שמירת סיסמה חדשה"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
