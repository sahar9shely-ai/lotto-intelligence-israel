import { motion } from "framer-motion";
import { SPLASH_WORDMARK, splashTimings, splitWordmark } from "./splashChoreography";

type WordmarkLettersProps = {
  id?: string;
  className?: string;
  compact: boolean;
  reduceMotion: boolean;
  exiting?: boolean;
  word?: string;
};

export function WordmarkLetters({
  id,
  className,
  compact,
  reduceMotion,
  exiting = false,
  word = SPLASH_WORDMARK,
}: WordmarkLettersProps) {
  const letters = splitWordmark(word);
  const timings = splashTimings(compact);

  if (reduceMotion) {
    return (
      <h1 id={id} className={className} dir="rtl">
        {word}
      </h1>
    );
  }

  return (
    <motion.h1
      id={id}
      className={className}
      dir="rtl"
      aria-label={word}
      initial={false}
      animate={exiting ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
      transition={
        exiting
          ? { duration: timings.copyExitDuration, ease: timings.fadeEase }
          : { duration: 0 }
      }
    >
      {letters.map((letter, index) => (
        <motion.span
          key={`${letter}-${index}`}
          className="welcome-splash__letter"
          aria-hidden="true"
          initial={{ opacity: 0, y: timings.letterFromY }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            ...timings.letterTween,
            delay: timings.letterDelay + index * timings.letterStagger,
          }}
        >
          {letter}
        </motion.span>
      ))}
    </motion.h1>
  );
}
