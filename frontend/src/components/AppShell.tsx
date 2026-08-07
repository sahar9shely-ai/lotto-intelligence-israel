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
  const [shared, setShared] = useState(false);
  const [slackBusy, setSlackBusy] = useState(false);
  const [slackNote, setSlackNote] = useState<string | null>(null);

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

  async function copyChatMessage() {
    const url = siteStatus?.public_url;
    if (!url) return;
    const text = `תזרים — כניסה מהירה לעבודה\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      setShared(true);
      window.setTimeout(() => setShared(false), 2200);
    } catch {
      /* ignore */
    }
  }

  async function sendToSlack() {
    setSlackBusy(true);
    setSlackNote(null);
    try {
      const res = await api.announcePublicUrl();
      setSlackNote(res.detail || "נשלח ל-Slack");
    } catch (err) {
      setSlackNote(err instanceof Error ? err.message : "שליחה ל-Slack נכשלה");
    } finally {
      setSlackBusy(false);
      window.setTimeout(() => setSlackNote(null), 4500);
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

      <div className="chrome" role="banner">
        <div className="chrome__inner">
          {isManager && siteStatus?.public_url ? (
            <div className="public-link-bar" role="status">
              <span className="public-link-bar__label">כניסה מהירה</span>
              <a
                className="public-link-bar__url"
                href={siteStatus.public_url}
                target="_blank"
                rel="noreferrer"
              >
                {siteStatus.public_url.replace(/^https?:\/\//, "")}
              </a>
              <div className="public-link-bar__actions">
                <button type="button" className="btn btn--small btn--ghost" onClick={copyPublicUrl}>
                  {copied ? "הועתק" : "העתק קישור"}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={copyChatMessage}>
                  {shared ? "מוכן לצ'אט" : "העתק לצ'אט"}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={slackBusy}
                  onClick={sendToSlack}
                >
                  {slackBusy ? "שולח..." : "שלח ל-Slack"}
                </button>
              </div>
              {slackNote ? <span className="public-link-bar__note">{slackNote}</span> : null}
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
        </div>
      </div>

      <div className="app">
        <main className="main">
          <Outlet />
        </main>
      </div>

      <nav className="dock" aria-label="ניווט מהיר">
        {links.map((link) => (
          <NavLink
            key={`dock-${link.to}`}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? "dock__link is-active" : "dock__link")}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
