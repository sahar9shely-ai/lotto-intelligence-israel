const MARK_SRC = "/assets/tazrim-mark.png?v=logo-a-homescreen";

export function BrandMark({
  className,
  size = 96,
  alt = "",
}: {
  className?: string;
  size?: number;
  alt?: string;
}) {
  return (
    <img
      className={className}
      src={MARK_SRC}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
    />
  );
}

export function AuthBrand({ kicker }: { kicker?: string }) {
  return (
    <div className="auth-card__identity">
      <BrandMark className="auth-card__logo" size={72} alt="" />
      {kicker ? <p className="auth-card__kicker">{kicker}</p> : null}
      <h1 className="auth-card__brand">תזרים</h1>
    </div>
  );
}
