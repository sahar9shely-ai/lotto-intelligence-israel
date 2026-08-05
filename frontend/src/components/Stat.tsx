type StatProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "manager";
  /** When set, the tile becomes a button that opens the matching detail. */
  onClick?: () => void;
  active?: boolean;
  title?: string;
};

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  onClick,
  active = false,
  title,
}: StatProps) {
  const className = [
    "stat",
    `tone-${tone}`,
    onClick ? "stat--clickable" : "",
    active ? "stat--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-pressed={active}
        title={title ?? `הצג פירוט: ${label}`}
      >
        <span className="stat__label">{label}</span>
        <strong className="stat__value">{value}</strong>
        {hint ? <span className="stat__hint">{hint}</span> : null}
      </button>
    );
  }

  return (
    <div className={className}>
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}
