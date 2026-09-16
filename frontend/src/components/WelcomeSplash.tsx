import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { getToken } from "../services/api";
import { isAdminAccount } from "../utils/roles";
import { hasSeenWelcome, markWelcomeSeen } from "../utils/welcomeSplash";
import { BrandMark } from "./BrandMark";
import { FallingWealth } from "./motion/FallingWealth";
import { MotionButton } from "./motion/MotionButton";
import { WordmarkLetters } from "./motion/WordmarkLetters";
import { splashTimings, useCompactSplash } from "./motion/splashChoreography";
import { useMotionPrefs } from "../hooks/useMotionPrefs";

export function WelcomeSplash() {
  const { user, loading } = useAuth();
  const titleId = useId();
  const copyId = useId();
  const ctaRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => !hasSeenWelcome());

  const { reduceMotion } = useMotionPrefs();
  const compact = useCompactSplash();
  const timings = splashTimings(compact);
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
      <div className="welcome-splash__sheet">
        <motion.div
          className="welcome-splash__seal"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduceMotion
              ? { duration: 0.28, ease: timings.fadeEase }
              : timings.sealSpring
          }
        >
          <motion.div
            className="welcome-splash__seal-float"
            animate={reduceMotion ? undefined : { y: [0, -4.5, 0] }}
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: timings.sealBreatheDuration,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: timings.sealBreatheDelay,
                  }
            }
          >
            <BrandMark className="welcome-splash__mark" size={128} alt="" />
          </motion.div>
        </motion.div>
        <motion.p
          className="welcome-splash__kicker"
          id={copyId}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0.28, ease: timings.fadeEase }
              : {
                  duration: compact ? 0.34 : 0.42,
                  delay: timings.kickerDelay,
                  ease: timings.fadeEase,
                }
          }
        >
          התיק שלך
        </motion.p>
        <WordmarkLetters
          id={titleId}
          className="welcome-splash__wordmark"
          compact={compact}
          reduceMotion={reduceMotion}
        />
        <motion.div
          className="welcome-splash__cta-enter"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduceMotion
              ? { duration: 0.28, ease: timings.fadeEase }
              : { ...timings.ctaSpring, delay: timings.ctaDelay }
          }
        >
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
    </div>
  );
}
