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
    <h1 id={id} className={className} aria-label={word}>
      {letters.map((letter, index) => (
        <motion.span
          key={`${letter}-${index}`}
          className="welcome-splash__letter"
          aria-hidden="true"
          initial={{ opacity: 0, y: timings.letterFromY, scale: 0.86 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            ...timings.letterSpring,
            delay: timings.letterDelay + index * timings.letterStagger,
          }}
        >
          {letter}
        </motion.span>
      ))}
    </h1>
  );
}
