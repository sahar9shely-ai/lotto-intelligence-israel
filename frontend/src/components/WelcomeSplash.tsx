import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { getToken } from "../services/api";
import { isAdminAccount } from "../utils/roles";
import { hasSeenWelcome, markWelcomeSeen } from "../utils/welcomeSplash";
import { BrandMark } from "./BrandMark";
import { FallingWealth } from "./motion/FallingWealth";
import { MotionButton } from "./motion/MotionButton";
import { useMotionPrefs } from "../hooks/useMotionPrefs";

export function WelcomeSplash() {
  const { user, loading } = useAuth();
  const titleId = useId();
  const copyId = useId();
  const ctaRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => !hasSeenWelcome());

  const { reduceMotion } = useMotionPrefs();
  const waitingOnSession = loading && Boolean(getToken());
  const hideForAdmin = Boolean(user && isAdminAccount(user));
  const visible = open && !waitingOnSession && !hideForAdmin;
  const userRef = useRef(user);

  const dismiss = useCallback(() => {
    markWelcomeSeen();
    setOpen(false);
  }, []);

  useEffect(() => {
    const wasSignedIn = Boolean(userRef.current);
    userRef.current = user;
    if (wasSignedIn && !user) {
      setOpen(!hasSeenWelcome());
    }
  }, [user]);

  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ctaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    <div
      className="welcome-splash"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={copyId}
    >
      <div className="welcome-splash__field" aria-hidden="true" />
      <FallingWealth />
      <motion.div
        className="welcome-splash__sheet"
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="welcome-splash__seal">
          <BrandMark className="welcome-splash__mark" size={128} alt="" />
        </div>
        <p className="welcome-splash__kicker" id={copyId}>
          התיק שלך
        </p>
        <h1 className="welcome-splash__wordmark" id={titleId}>
          תזרים
        </h1>
        <MotionButton
          ref={ctaRef}
          type="button"
          className="welcome-splash__cta"
          onClick={dismiss}
        >
          המשך
        </MotionButton>
      </motion.div>
    </div>
  );
}
