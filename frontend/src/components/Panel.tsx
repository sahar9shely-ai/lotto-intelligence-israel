import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function Panel({ title, subtitle, action, children, className = "", delay = 0 }: PanelProps) {
  return (
    <section
      className={`panel ${className}`.trim()}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="panel__head">
        <div>
          <h2 className="panel__title">{title}</h2>
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
        {action ? <div className="panel__action">{action}</div> : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}
