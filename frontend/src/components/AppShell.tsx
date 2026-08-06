import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isManager = Boolean(user?.is_manager);
  const { data: siteStatus, reload: reloadStatus } = useAsync(
    () => api.siteStatus(),
    [user?.id],
  );
  const [copied, setCopied] = useState(false);

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

  async function copyPublicUrl() {
    const url = siteStatus?.public_url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="shell">
      <div className="atmosphere" aria-hidden="true" />
      {siteStatus?.site_updating ? (
        <div className="site-update-banner" role="status">
          <strong>האתר בעדכון</strong>
          <span>{siteStatus.site_updating_message}</span>
        </div>
      ) : null}
      <div className="app">
        {isManager && siteStatus?.public_url ? (
          <div className="public-link-bar" role="status">
            <span className="public-link-bar__label">קישור ציבורי פעיל</span>
            <a
              className="public-link-bar__url"
              href={siteStatus.public_url}
              target="_blank"
              rel="noreferrer"
            >
              {siteStatus.public_url.replace(/^https?:\/\//, "")}
            </a>
            <button type="button" className="btn btn--small btn--ghost" onClick={copyPublicUrl}>
              {copied ? "הועתק" : "העתק"}
            </button>
          </div>
        ) : null}
        <header className="topbar">
          <div className="brand">
            <span className="brand__mark">תזרים</span>
            <span className="brand__tag">
              {user?.investor_name || "מעקב השקעות שותפים"}
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
            <button
              type="button"
              className="nav__link nav__logout"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              יציאה
            </button>
          </nav>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
