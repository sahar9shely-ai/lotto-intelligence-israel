import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/app/home", label: "בית", icon: "⌂" },
  { to: "/app/discover", label: "לגלות", icon: "◎" },
  { to: "/app/premium", label: "פרימיום", icon: "♛" },
  { to: "/app/chat", label: "קהילה", icon: "♡" },
  { to: "/app/profile", label: "פרופיל", icon: "☺" },
] as const;

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `bottom-nav__item${isActive ? " is-active" : ""}`
          }
        >
          <span className="bottom-nav__icon" aria-hidden>
            {tab.icon}
          </span>
          <span className="bottom-nav__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
