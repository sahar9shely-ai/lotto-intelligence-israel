import { useEffect, useState } from "react";

function readMq(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

/**
 * Central motion gates:
 * - prefers-reduced-motion → no/minimal animation
 * - tilt / mouse-follow only on fine pointers (desktop), never on coarse/touch
 */
export function useMotionPrefs() {
  const [reduceMotion, setReduceMotion] = useState(() =>
    readMq("(prefers-reduced-motion: reduce)"),
  );
  const [finePointer, setFinePointer] = useState(() =>
    readMq("(hover: hover) and (pointer: fine)"),
  );
  const [coarsePointer, setCoarsePointer] = useState(() =>
    readMq("(pointer: coarse)"),
  );

  useEffect(() => {
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fineMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const coarseMq = window.matchMedia("(pointer: coarse)");

    const sync = () => {
      setReduceMotion(reduceMq.matches);
      setFinePointer(fineMq.matches);
      setCoarsePointer(coarseMq.matches);
    };

    sync();
    reduceMq.addEventListener("change", sync);
    fineMq.addEventListener("change", sync);
    coarseMq.addEventListener("change", sync);
    return () => {
      reduceMq.removeEventListener("change", sync);
      fineMq.removeEventListener("change", sync);
      coarseMq.removeEventListener("change", sync);
    };
  }, []);

  const allowHoverMotion = !reduceMotion && finePointer && !coarsePointer;

  return {
    reduceMotion,
    allowTilt: allowHoverMotion,
    allowMouseFollow: allowHoverMotion,
    allowScrollReveal: !reduceMotion,
  };
}
