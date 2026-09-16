import { useEffect, useState } from "react";

export const SPLASH_WORDMARK = "תזרים";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Camera push — slow start, confident finish. */
const EASE_ZOOM: [number, number, number, number] = [0.16, 0.72, 0.12, 1];
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

export type SplashExitTransform = {
  shiftX: number;
  shiftY: number;
  scale: number;
};

/**
 * Dolly the seal's center to the viewport center, then scale so the circle
 * covers (or nearly covers) the screen. Transform origin stays at 50% 50%.
 */
export function splashExitTransform(rect: DOMRect): SplashExitTransform {
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  return {
    shiftX: vw / 2 - cx,
    shiftY: vh / 2 - cy,
    scale: Math.max(vw / width, vh / height) * 1.08,
  };
}

export function splashTimings(compact: boolean) {
  const letterCount = Math.max(splitWordmark(SPLASH_WORDMARK).length, 1);
  // Slow, readable RTL stagger — fade+rise, not a bounce.
  const letterDelay = compact ? 0.28 : 0.4;
  const letterStagger = compact ? 0.16 : 0.2;
  const letterDuration = compact ? 0.72 : 0.9;
  const lastLetterAt = letterDelay + (letterCount - 1) * letterStagger;
  const kickerDelay = lastLetterAt + (compact ? 0.42 : 0.58);
  const ctaDelay = kickerDelay + (compact ? 0.32 : 0.42);

  const copyExitDuration = compact ? 0.28 : 0.34;
  const zoomDuration = compact ? 0.78 : 0.92;
  const holdAtFill = compact ? 0.18 : 0.24;
  const splashFadeDuration = compact ? 0.58 : 0.72;
  const reducedExitDuration = 0.32;

  return {
    letterDelay,
    letterStagger,
    letterDuration,
    letterFromY: compact ? 12 : 16,
    kickerDelay,
    ctaDelay,
    sealBreatheDelay: compact ? 0.82 : 1.05,
    sealBreatheDuration: compact ? 3.4 : 4,
    letterTween: {
      duration: letterDuration,
      ease: EASE_LUXE,
    },
    sealSpring: {
      type: "spring" as const,
      stiffness: compact ? 180 : 150,
      damping: 22,
      mass: 0.9,
    },
    ctaSpring: {
      type: "spring" as const,
      stiffness: compact ? 220 : 190,
      damping: 24,
      mass: 0.7,
    },
    fadeEase: EASE_LUXE,
    zoomEase: EASE_ZOOM,
    copyExitDuration,
    wealthExitDuration: compact ? 0.3 : 0.36,
    zoomDelay: copyExitDuration * 0.35,
    zoomDuration,
    holdAtFill,
    splashFadeDuration,
    reducedExitDuration,
    zoomHoldDuration: copyExitDuration * 0.35 + zoomDuration + holdAtFill,
    exitTotalDuration:
      copyExitDuration * 0.35 + zoomDuration + holdAtFill + splashFadeDuration,
    kickerEnterDuration: compact ? 0.42 : 0.52,
  };
}
