import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/", label: "לוח בקרה", end: true },
  { to: "/investors", label: "משקיעים" },
  { to: "/payments", label: "תשלומים" },
  { to: "/quotes", label: "הצעות" },
  { to: "/settings", label: "הגדרות" },
];

export function AppShell() {
  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">תזרים</span>
          <span className="brand__tag">מעקב השקעות שותפים</span>
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
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
