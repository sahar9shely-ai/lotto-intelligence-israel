import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionPrefs } from "../../hooks/useMotionPrefs";

export function PageTransition({ children }: { children: ReactNode }) {
  const { reduceMotion } = useMotionPrefs();

  return (
    <motion.div
      className="page-transition"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
      transition={{
        duration: reduceMotion ? 0 : 0.26,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
