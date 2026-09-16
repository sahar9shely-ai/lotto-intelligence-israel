import { useEffect, useState } from "react";

export const SPLASH_WORDMARK = "תזרים";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const COMPACT_MQ = "(max-width: 640px)";

function readMq(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

/** Compact (mobile) timings are the same path, slightly shorter. */
export function useCompactSplash(): boolean {
  const [compact, setCompact] = useState(() => readMq(COMPACT_MQ));

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_MQ);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return compact;
}

export function splitWordmark(word: string): string[] {
  return Array.from(word);
}

export function splashTimings(compact: boolean) {
  const letterDelay = compact ? 0.12 : 0.16;
  const letterStagger = compact ? 0.05 : 0.07;
  const lastLetterAt = letterDelay + 4 * letterStagger;
  const kickerDelay = lastLetterAt + (compact ? 0.18 : 0.22);
  const ctaDelay = kickerDelay + (compact ? 0.16 : 0.22);

  return {
    letterDelay,
    letterStagger,
    letterFromY: compact ? 20 : 28,
    kickerDelay,
    ctaDelay,
    sealBreatheDelay: compact ? 0.48 : 0.62,
    sealBreatheDuration: compact ? 3.15 : 3.7,
    letterSpring: {
      type: "spring" as const,
      stiffness: compact ? 380 : 320,
      damping: compact ? 16 : 14,
      mass: compact ? 0.52 : 0.6,
    },
    sealSpring: {
      type: "spring" as const,
      stiffness: compact ? 280 : 240,
      damping: 20,
      mass: 0.82,
    },
    ctaSpring: {
      type: "spring" as const,
      stiffness: compact ? 340 : 300,
      damping: 22,
      mass: 0.55,
    },
    fadeEase: EASE_LUXE,
  };
}
