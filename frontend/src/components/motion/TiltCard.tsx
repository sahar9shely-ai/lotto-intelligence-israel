import { motion, useMotionValue, useSpring } from "framer-motion";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useMotionPrefs } from "../../hooks/useMotionPrefs";

const SPRING = { stiffness: 220, damping: 22, mass: 0.45 };
const MAX_TILT = 5.5;

type TiltCardProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  as?: "div" | "section";
  style?: CSSProperties;
  enabled?: boolean;
};

export function TiltCard({
  children,
  className,
  id,
  as = "div",
  style,
  enabled = true,
}: TiltCardProps) {
  const { allowTilt } = useMotionPrefs();
  const active = enabled && allowTilt;
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, SPRING);
  const springY = useSpring(rotateY, SPRING);
  const Comp = as === "section" ? motion.section : motion.div;

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!active || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    rotateX.set((0.5 - py) * MAX_TILT);
    rotateY.set((px - 0.5) * MAX_TILT);
  }

  function resetTilt() {
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <Comp
      id={id}
      className={["tilt-card", className].filter(Boolean).join(" ")}
      style={{
        ...style,
        rotateX: active ? springX : 0,
        rotateY: active ? springY : 0,
        transformPerspective: 900,
      }}
      onPointerMove={active ? onPointerMove : undefined}
      onPointerLeave={active ? resetTilt : undefined}
    >
      {children}
    </Comp>
  );
}
