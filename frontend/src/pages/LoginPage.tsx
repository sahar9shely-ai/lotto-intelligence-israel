import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AuthBrand } from "../components/BrandMark";
import { MotionButton } from "../components/motion/MotionButton";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { useMotionPrefs } from "../hooks/useMotionPrefs";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const { reduceMotion } = useMotionPrefs();
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
      <motion.div
        className="auth-card"
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <AuthBrand kicker="התיק שלך" />

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
          <MotionButton type="submit" className="btn btn--primary btn--wide" disabled={busy}>
            {busy ? "נכנס..." : "כניסה לתיק הפרטי"}
          </MotionButton>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">שכחתי סיסמה</Link>
        </div>
      </motion.div>
    </div>
  );
}
