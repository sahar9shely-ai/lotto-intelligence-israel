import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

export function AppShell() {
  const { user, logout } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const { data: siteStatus, reload: reloadStatus } = useAsync(
    () => api.siteStatus(),
    [user?.id],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      reloadStatus();
    }, 20000);
    return () => window.clearInterval(id);
  }, [reloadStatus]);

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
      {siteStatus?.site_updating ? (
        <div className="site-update-banner" role="status">
          <strong>האתר בעדכון</strong>
          <span>{siteStatus.site_updating_message}</span>
        </div>
      ) : null}
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">תזרים</span>
          <span className="brand__tag">
            {user ? `${user.investor_name} · ${user.username}` : "מעקב השקעות שותפים"}
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
          <button type="button" className="nav__link nav__logout" onClick={() => { logout(); window.location.assign("/login"); }}>
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
