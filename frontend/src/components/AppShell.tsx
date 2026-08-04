import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function AppShell() {
  const { user, logout } = useAuth();
  const isManager = Boolean(user?.is_manager);

  const links = [
    { to: "/", label: "לוח בקרה", end: true, managerOnly: false },
    { to: "/investors", label: isManager ? "משקיעים" : "המסלול שלי", managerOnly: false },
    { to: "/payments", label: "תשלומים", managerOnly: false },
    { to: "/quotes", label: "הצעות", managerOnly: true },
    { to: "/users", label: "משתמשים", managerOnly: true },
    { to: "/settings", label: "הגדרות", managerOnly: true },
  ].filter((l) => !l.managerOnly || isManager);

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">תזרים</span>
          <span className="brand__tag">
            {user ? `${user.investor_name} · ${user.email}` : "מעקב השקעות שותפים"}
          </span>
        </div>
        <nav className="nav" aria-label="ניווט ראשי">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? "nav__link is-active" : "nav__link")}
            >
              {link.label}
            </NavLink>
          ))}
          <button type="button" className="nav__link nav__logout" onClick={logout}>
            יציאה
          </button>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
