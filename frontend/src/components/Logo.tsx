export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`logo logo--${size}`} aria-label="GOT URS">
      <span className="logo__text">
        GOT <span className="logo__spark">✦</span> URS
      </span>
      <span className="logo__heart" aria-hidden>
        ♡
      </span>
    </div>
  );
}
