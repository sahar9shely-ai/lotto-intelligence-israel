import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { useAuth } from "../context/AuthContext";

const BENEFITS = [
  "חדרים בלעדיים",
  "תוכן חדש כל שבוע",
  "גישה מוקדמת",
  "בלי הגבלות",
  "בלי פרסומות",
];

export function PremiumPage() {
  const { user, upgradePremium } = useAuth();

  return (
    <AppShell>
      <section className="section premium-screen">
        <div className="premium-diamond" aria-hidden>
          ◆
        </div>
        <h1>GOT URS PREMIUM</h1>
        <p className="page-sub">שדרגו את החוויה לרמה הבאה</p>
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
            onClick={() => void upgradePremium()}
          >
            שדרגי לפרימיום
          </GlowButton>
        )}
      </section>
    </AppShell>
  );
}
