import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { POINT_ACTIONS } from "../data/rooms";

const RANKS = [
  { id: "beginner", label: "מתחיל/ה" },
  { id: "explorer", label: "חוקר/ת" },
  { id: "advanced", label: "מתקדם/ת" },
  { id: "legend", label: "אגדה" },
] as const;

export function PointsPage() {
  const { user } = useAuth();
  const next = Math.ceil((user.points + 1) / 5000) * 5000 || 5000;
  const progress = Math.min(100, Math.round((user.points / next) * 100));
  const rankIndex = Math.min(
    RANKS.length - 1,
    Math.floor(user.points / 1000),
  );

  return (
    <AppShell showBack backTo="/app/profile" hideNav>
      <section className="section points-screen">
        <div className="points-circle">
          <strong>{user.points.toLocaleString("he-IL")}</strong>
          <span>נקודות</span>
        </div>
        <div className="progress">
          <div className="progress__bar" style={{ width: `${progress}%` }} />
        </div>
        <p className="page-sub">
          {user.points.toLocaleString("he-IL")} / {next.toLocaleString("he-IL")} לרמה הבאה
        </p>

        <div className="ranks">
          {RANKS.map((rank, i) => (
            <div
              key={rank.id}
              className={`rank${i <= rankIndex ? " is-on" : ""}`}
            >
              <span>✦</span>
              <small>{rank.label}</small>
            </div>
          ))}
        </div>

        <h2 className="section__title">איך צוברים נקודות</h2>
        <ul className="points-list">
          {POINT_ACTIONS.map((action) => (
            <li key={action.id}>
              <span>{action.label}</span>
              <strong>+{action.points}</strong>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
