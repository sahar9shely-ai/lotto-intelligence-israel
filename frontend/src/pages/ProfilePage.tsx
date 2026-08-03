import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { ACHIEVEMENTS } from "../data/rooms";

export function ProfilePage() {
  const { user, isGuest } = useAuth();

  return (
    <AppShell>
      <section className="profile-screen section">
        <div className="profile-hero">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <h1>{user.name}</h1>
          <p className="level-pill">רמה {user.level}</p>
          {isGuest ? (
            <Link to="/login" className="text-link">
              התחברו כדי לסנכרן לטלפון אחר
            </Link>
          ) : (
            <p className="sync-ok">✓ מסונכרן לענן</p>
          )}
        </div>

        <div className="stats-row">
          <div>
            <strong>{user.roomsOpened}</strong>
            <span>חדרים</span>
          </div>
          <div>
            <strong>
              {user.points >= 1000
                ? `${(user.points / 1000).toFixed(1)}K`
                : user.points}
            </strong>
            <span>נקודות</span>
          </div>
          <div>
            <strong>{user.friends}</strong>
            <span>חברים</span>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2>הישגים שלי</h2>
            <Link to="/app/points">הכל ›</Link>
          </div>
          <div className="achievements">
            {ACHIEVEMENTS.map((a) => {
              const unlocked = user.achievements.includes(a.id);
              return (
                <div
                  key={a.id}
                  className={`achievement${unlocked ? " is-on" : ""}`}
                >
                  <span>{a.icon}</span>
                  <small>{a.title}</small>
                </div>
              );
            })}
          </div>
        </div>

        <div className="link-list">
          <Link to="/app/points">נקודות והישגים</Link>
          <Link to="/app/invite">הזמנת חברים</Link>
          <Link to="/app/settings">הגדרות</Link>
        </div>
      </section>
    </AppShell>
  );
}
