import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";

const ITEMS = [
  { to: "/app/profile", label: "פרטים אישיים", icon: "☺" },
  { to: "/app/invite", label: "התראות", icon: "⌐" },
  { to: "/app/premium", label: "פרטיות ואבטחה", icon: "盾" },
  { to: "/app/settings", label: "שפה · עברית", icon: "א" },
  { to: "/app/points", label: "עזרה ותמיכה", icon: "?" },
  { to: "/app/home", label: "תנאי שימוש", icon: "≡" },
  { to: "/app/home", label: "מדיניות פרטיות", icon: "◉" },
] as const;

export function SettingsPage() {
  const { logout, isGuest } = useAuth();
  const navigate = useNavigate();

  return (
    <AppShell showBack backTo="/app/profile" hideNav>
      <section className="section">
        <h1 className="page-title">הגדרות</h1>
        <div className="settings-list">
          {ITEMS.map((item) => (
            <Link key={item.label} to={item.to} className="settings-item">
              <span className="settings-item__icon">{item.icon === "盾" ? "⛨" : item.icon}</span>
              <span>{item.label}</span>
              <span aria-hidden>‹</span>
            </Link>
          ))}
        </div>
        <button
          type="button"
          className="logout-btn"
          onClick={() => {
            logout();
            navigate(isGuest ? "/" : "/login");
          }}
        >
          התנתק/י
        </button>
      </section>
    </AppShell>
  );
}
