import { motion } from "framer-motion";
import type { AriaRole, CSSProperties, ReactNode } from "react";
import { useMotionPrefs } from "../../hooks/useMotionPrefs";

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  id?: string;
  role?: AriaRole;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function ScrollReveal({
  children,
  className,
  delay = 0,
  id,
  role,
  style,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: ScrollRevealProps) {
  const { reduceMotion } = useMotionPrefs();
  const shared = {
    className,
    id,
    role,
    style,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
  };

  if (reduceMotion) {
    return <div {...shared}>{children}</div>;
  }

  return (
    <motion.div
      {...shared}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.14 }}
      transition={{
        duration: 0.42,
        delay: delay / 1000,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
