import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GlowButton } from "../components/GlowButton";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("סהר");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim() || "סהר");
      }
      navigate("/app/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהתחברות");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <Logo size="md" />
      <h1 className="auth-screen__title">
        {mode === "login" ? "התחברות" : "יצירת חשבון"}
      </h1>
      <p className="auth-screen__sub">
        אותם נתונים בכל טלפון — התחברו וסנכרנו אוטומטית
      </p>

      <form className="auth-form" onSubmit={onSubmit}>
        {mode === "register" ? (
          <label className="field">
            <span>שם</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="השם שלך"
              required
            />
          </label>
        ) : null}
        <label className="field">
          <span>אימייל</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            required
            dir="ltr"
          />
        </label>
        <label className="field">
          <span>סיסמה</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="לפחות 4 תווים"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={4}
            required
            dir="ltr"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <GlowButton type="submit" disabled={busy}>
          {busy ? "רק רגע..." : mode === "login" ? "התחבר" : "הצטרפי עכשיו"}
        </GlowButton>
      </form>

      <button
        type="button"
        className="text-link"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "אין חשבון? הירשמו" : "כבר יש חשבון? התחברו"}
      </button>
      <Link to="/" className="text-link">
        › חזרה
      </Link>
    </div>
  );
}
