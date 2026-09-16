import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";
import { useMotionPrefs } from "../../hooks/useMotionPrefs";

type MotionButtonProps = HTMLMotionProps<"button">;

export const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  function MotionButton(
    { children, disabled, whileHover, whileTap, transition, ...rest },
    ref,
  ) {
    const { reduceMotion } = useMotionPrefs();
    const allow = !reduceMotion && !disabled;

    return (
      <motion.button
        ref={ref}
        disabled={disabled}
        whileHover={whileHover ?? (allow ? { y: -1 } : undefined)}
        whileTap={whileTap ?? (allow ? { scale: 0.97 } : undefined)}
        transition={
          transition ?? { type: "spring", stiffness: 520, damping: 28, mass: 0.35 }
        }
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);
