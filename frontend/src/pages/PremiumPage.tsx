import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { useAuth } from "../context/AuthContext";
import { formatIls, PREMIUM_PLANS } from "../data/rooms";

const BENEFITS = [
  "חדרים בלעדיים",
  "תוכן חדש כל שבוע",
  "גישה מוקדמת",
  "בלי הגבלות",
  "בלי פרסומות",
  "תשלום נוח בביט",
];

export function PremiumPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [planId, setPlanId] = useState<(typeof PREMIUM_PLANS)[number]["id"]>(
    "premium-month",
  );

  return (
    <AppShell>
      <section className="section premium-screen">
        <div className="premium-diamond" aria-hidden>
          ◆
        </div>
        <h1>GOT URS PREMIUM</h1>
        <p className="page-sub">שדרגו את החוויה — תשלום מאובטח בביט</p>

        <div className="plan-grid">
          {PREMIUM_PLANS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              className={`plan-card${planId === plan.id ? " is-selected" : ""}`}
              onClick={() => setPlanId(plan.id)}
            >
              <span className="plan-card__badge">{plan.badge}</span>
              <strong>{plan.title}</strong>
              <small>{plan.subtitle}</small>
              <span className="price-tag">
                {formatIls(plan.priceIls)}
                <em>/{plan.period.replace("ל", "")}</em>
              </span>
            </button>
          ))}
        </div>

        <ul className="benefit-list">
          {BENEFITS.map((item) => (
            <li key={item}>
              <span>✓</span>
              {item}
            </li>
          ))}
        </ul>

        {user.isPremium ? (
          <p className="sync-ok">אתם כבר בפרימיום ✦</p>
        ) : (
          <GlowButton
            variant="gold"
            onClick={() =>
              navigate(`/app/pay?kind=premium&item=${encodeURIComponent(planId)}`)
            }
          >
            שלמו בביט ושדרגו
          </GlowButton>
        )}
      </section>
    </AppShell>
  );
}
