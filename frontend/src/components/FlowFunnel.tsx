import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type FunnelStep = {
  id: string;
  label: string;
  hint?: string;
};

type FlowFunnelProps = {
  title?: string;
  subtitle?: string;
  steps: FunnelStep[];
  /** 0-based index of the current step */
  current: number;
  className?: string;
};

/** Visual behavioral funnel — shows where the user/admin is in a multi-step journey. */
export function FlowFunnel({
  title,
  subtitle,
  steps,
  current,
  className = "",
}: FlowFunnelProps) {
  return (
    <section className={`flow-funnel ${className}`.trim()} aria-label={title || "תהליך"}>
      {title ? (
        <header className="flow-funnel__head">
          <h2 className="flow-funnel__title">{title}</h2>
          {subtitle ? <p className="flow-funnel__subtitle">{subtitle}</p> : null}
        </header>
      ) : null}
      <ol className="flow-funnel__steps">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step.id}
              className={
                done
                  ? "flow-funnel__step is-done"
                  : active
                    ? "flow-funnel__step is-current"
                    : "flow-funnel__step"
              }
            >
              <span className="flow-funnel__num" aria-hidden>
                {done ? "✓" : index + 1}
              </span>
              <div className="flow-funnel__text">
                <strong>{step.label}</strong>
                {step.hint ? <em>{step.hint}</em> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export type NextAction = {
  id: string;
  eyebrow?: string;
  title: string;
  detail: string;
  cta: string;
  to?: string;
  onClick?: () => void;
  tone?: "admin" | "gold" | "default" | "whatsapp";
};

type NextActionsHubProps = {
  title: string;
  subtitle?: string;
  actions: NextAction[];
  empty?: ReactNode;
};

function actionBtnClass(tone?: NextAction["tone"]) {
  if (tone === "admin") return "btn btn--small btn--admin";
  if (tone === "gold") return "btn btn--small btn--gold";
  if (tone === "whatsapp") return "btn btn--small btn--whatsapp";
  return "btn btn--small btn--primary";
}

/** Action windows — clear next steps for admin or investor. */
export function NextActionsHub({ title, subtitle, actions, empty }: NextActionsHubProps) {
  if (actions.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  return (
    <section className="next-hub" aria-label={title}>
      <header className="next-hub__head">
        <h2 className="next-hub__title">{title}</h2>
        {subtitle ? <p className="next-hub__subtitle">{subtitle}</p> : null}
      </header>
      <div className="next-hub__grid">
        {actions.map((action) => (
          <article key={action.id} className={`next-card next-card--${action.tone || "default"}`}>
            {action.eyebrow ? <p className="next-card__eyebrow">{action.eyebrow}</p> : null}
            <h3 className="next-card__title">{action.title}</h3>
            <p className="next-card__detail">{action.detail}</p>
            {action.to ? (
              <Link className={actionBtnClass(action.tone)} to={action.to}>
                {action.cta}
              </Link>
            ) : (
              <button type="button" className={actionBtnClass(action.tone)} onClick={action.onClick}>
                {action.cta}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
