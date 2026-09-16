import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { PointerEvent, ReactNode } from "react";
import { useMotionPrefs } from "../../hooks/useMotionPrefs";

const SPRING = { stiffness: 70, damping: 18, mass: 0.4 };

type HeroDepthProps = {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function HeroDepth({
  children,
  className,
  "aria-label": ariaLabel,
}: HeroDepthProps) {
  const { allowMouseFollow, reduceMotion } = useMotionPrefs();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, SPRING);
  const sy = useSpring(py, SPRING);
  const glowX = useTransform(sx, (v) => v * 26);
  const glowY = useTransform(sy, (v) => v * 18);

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!allowMouseFollow || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function onPointerLeave() {
    px.set(0);
    py.set(0);
  }

  return (
    <motion.section
      className={className}
      aria-label={ariaLabel}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={allowMouseFollow ? onPointerMove : undefined}
      onPointerLeave={allowMouseFollow ? onPointerLeave : undefined}
    >
      {allowMouseFollow ? (
        <motion.div
          className="hero-depth__glow"
          aria-hidden="true"
          style={{ x: glowX, y: glowY }}
        />
      ) : null}
      {children}
    </motion.section>
  );
}
