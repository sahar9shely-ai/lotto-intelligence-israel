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
import {
  splashExitTransform,
  splashTimings,
  useCompactSplash,
  type SplashExitTransform,
} from "./motion/splashChoreography";
import { useMotionPrefs } from "../hooks/useMotionPrefs";

const REST_EXIT: SplashExitTransform = { shiftX: 0, shiftY: 0, scale: 1 };
const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

export function WelcomeSplash() {
  const { user, loading } = useAuth();
  const titleId = useId();
  const copyId = useId();
  const ctaRef = useRef<HTMLButtonElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(() => !hasSeenWelcome());
  const [exiting, setExiting] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [exitTransform, setExitTransform] = useState<SplashExitTransform>(REST_EXIT);

  const { reduceMotion } = useMotionPrefs();
  const compact = useCompactSplash();
  const timings = splashTimings(compact);
  const waitingOnSession = loading && Boolean(getToken());
  const hideForAdmin = Boolean(user && isAdminAccount(user));
  const visible = open && !waitingOnSession && !hideForAdmin;
  const userRef = useRef(user);

  const finishExit = useCallback(() => {
    setOpen(false);
    setExiting(false);
    setFadingOut(false);
    setExitTransform(REST_EXIT);
  }, []);

  const dismiss = useCallback(() => {
    if (exiting) {
      finishExit();
      return;
    }
    markWelcomeSeen();
    const el = sealRef.current;
    if (!reduceMotion && el) {
      setExitTransform(splashExitTransform(el.getBoundingClientRect()));
    }
    setExiting(true);
  }, [exiting, finishExit, reduceMotion]);

  useEffect(() => {
    const wasSignedIn = Boolean(userRef.current);
    userRef.current = user;
    if (wasSignedIn && !user) {
      setExiting(false);
      setFadingOut(false);
      setExitTransform(REST_EXIT);
      setOpen(!hasSeenWelcome());
    }
  }, [user]);

  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!exiting) ctaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, dismiss, exiting]);

  useEffect(() => {
    if (!exiting || fadingOut) return;
    const seconds = reduceMotion ? 0 : timings.zoomHoldDuration;
    const id = window.setTimeout(() => setFadingOut(true), Math.round(seconds * 1000));
    return () => window.clearTimeout(id);
  }, [exiting, fadingOut, reduceMotion, timings.zoomHoldDuration]);

  useEffect(() => {
    if (!exiting) return;
    if (!reduceMotion && !fadingOut) return;
    const seconds = reduceMotion ? timings.reducedExitDuration : timings.splashFadeDuration;
    const id = window.setTimeout(finishExit, Math.round(seconds * 1000));
    return () => window.clearTimeout(id);
  }, [
    exiting,
    fadingOut,
    reduceMotion,
    timings.reducedExitDuration,
    timings.splashFadeDuration,
    finishExit,
  ]);

  if (!visible) return null;

  const splashFadeMs = reduceMotion
    ? timings.reducedExitDuration
    : timings.splashFadeDuration;

  return (
    <div
      className={exiting ? "welcome-splash is-exiting" : "welcome-splash"}
      data-splash-motion={reduceMotion ? "reduce" : "full"}
      data-splash-compact={compact ? "1" : "0"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={copyId}
      aria-busy={exiting || undefined}
      style={{
        opacity: fadingOut || (exiting && reduceMotion) ? 0 : 1,
        transition:
          fadingOut || (exiting && reduceMotion)
            ? `opacity ${splashFadeMs}s ${EASE_CSS}`
            : undefined,
      }}
    >
      <motion.div
        className="welcome-splash__field"
        aria-hidden="true"
        inherit={false}
        initial={false}
        animate={exiting && !reduceMotion ? { scale: 1.14 } : { scale: 1 }}
        transition={{
          duration: reduceMotion ? 0.2 : timings.zoomDuration,
          delay: exiting && !reduceMotion ? timings.zoomDelay : 0,
          ease: timings.zoomEase,
        }}
      />
      <motion.div
        className="welcome-splash__wealth"
        aria-hidden="true"
        inherit={false}
        initial={false}
        animate={{ opacity: exiting ? 0 : 1 }}
        transition={{
          duration: reduceMotion ? 0.2 : timings.wealthExitDuration,
          ease: timings.fadeEase,
        }}
      >
        <FallingWealth />
      </motion.div>
      <div className="welcome-splash__sheet">
        <motion.div
          ref={sealRef}
          className="welcome-splash__seal"
          inherit={false}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
          animate={
            exiting
              ? reduceMotion
                ? { opacity: 1, scale: 1, x: 0, y: 0 }
                : {
                    opacity: 1,
                    scale: exitTransform.scale,
                    x: exitTransform.shiftX,
                    y: exitTransform.shiftY,
                  }
              : { opacity: 1, scale: 1, x: 0, y: 0 }
          }
          transition={
            exiting && !reduceMotion
              ? {
                  scale: {
                    duration: timings.zoomDuration,
                    delay: timings.zoomDelay,
                    ease: timings.zoomEase,
                  },
                  x: {
                    duration: timings.zoomDuration,
                    delay: timings.zoomDelay,
                    ease: timings.zoomEase,
                  },
                  y: {
                    duration: timings.zoomDuration,
                    delay: timings.zoomDelay,
                    ease: timings.zoomEase,
                  },
                }
              : reduceMotion
                ? { duration: 0.28, ease: timings.fadeEase }
                : timings.sealSpring
          }
        >
          <motion.div
            className="welcome-splash__seal-float"
            inherit={false}
            animate={exiting || reduceMotion ? { y: 0 } : { y: [0, -4.5, 0] }}
            transition={
              exiting || reduceMotion
                ? { duration: 0.22, ease: timings.fadeEase }
                : {
                    duration: timings.sealBreatheDuration,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: timings.sealBreatheDelay,
                  }
            }
          >
            <BrandMark className="welcome-splash__mark" size={385} alt="" />
          </motion.div>
        </motion.div>
        <motion.p
          className="welcome-splash__kicker"
          id={copyId}
          inherit={false}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={exiting ? { opacity: 0, y: -8 } : { opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0.28, ease: timings.fadeEase }
              : exiting
                ? { duration: timings.copyExitDuration, ease: timings.fadeEase }
                : {
                    duration: timings.kickerEnterDuration,
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
          inherit={false}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={
            exiting ? { opacity: 0, y: 10, scale: 0.98 } : { opacity: 1, scale: 1, y: 0 }
          }
          transition={
            reduceMotion
              ? { duration: 0.28, ease: timings.fadeEase }
              : exiting
                ? { duration: timings.copyExitDuration, ease: timings.fadeEase }
                : { ...timings.ctaSpring, delay: timings.ctaDelay }
          }
        >
          <MotionButton
            ref={ctaRef}
            type="button"
            className="welcome-splash__cta"
            onClick={dismiss}
            disabled={exiting}
          >
            המשך
          </MotionButton>
        </motion.div>
      </div>
    </div>
  );
}
