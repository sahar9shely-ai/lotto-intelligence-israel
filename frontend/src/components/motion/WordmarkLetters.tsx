import { motion } from "framer-motion";
import { SPLASH_WORDMARK, splashTimings, splitWordmark } from "./splashChoreography";

type WordmarkLettersProps = {
  id?: string;
  className?: string;
  compact: boolean;
  reduceMotion: boolean;
  word?: string;
};

export function WordmarkLetters({
  id,
  className,
  compact,
  reduceMotion,
  word = SPLASH_WORDMARK,
}: WordmarkLettersProps) {
  const letters = splitWordmark(word);
  const timings = splashTimings(compact);

  if (reduceMotion) {
    return (
      <h1 id={id} className={className}>
        {word}
      </h1>
    );
  }

  return (
    <motion.h1
      id={id}
      className={className}
      aria-label={word}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: timings.letterStagger,
            delayChildren: timings.letterDelay,
          },
        },
      }}
    >
      {letters.map((letter, index) => (
        <motion.span
          key={`${letter}-${index}`}
          className="welcome-splash__letter"
          aria-hidden="true"
          variants={{
            hidden: {
              opacity: 0,
              y: timings.letterFromY,
              scale: 0.88,
            },
            show: {
              opacity: 1,
              y: 0,
              scale: 1,
              transition: timings.letterSpring,
            },
          }}
        >
          {letter}
        </motion.span>
      ))}
    </motion.h1>
  );
}
