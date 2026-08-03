import type { ButtonHTMLAttributes, ReactNode } from "react";

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "ghost" | "gold";
  fullWidth?: boolean;
}

export function GlowButton({
  children,
  variant = "primary",
  fullWidth = true,
  className = "",
  ...rest
}: GlowButtonProps) {
  return (
    <button
      type="button"
      className={`glow-btn glow-btn--${variant}${fullWidth ? " glow-btn--full" : ""} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
