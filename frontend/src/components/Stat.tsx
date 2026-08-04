type StatProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "manager";
};

export function Stat({ label, value, hint, tone = "default" }: StatProps) {
  return (
    <div className={`stat tone-${tone}`}>
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}
