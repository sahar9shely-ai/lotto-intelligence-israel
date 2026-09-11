import { PersonalAssistant } from "./PersonalAssistant";
import { NotificationCenter } from "./NotificationCenter";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isAdminAccount } from "../utils/roles";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

const PRIMARY_PATHS = new Set(["/", "/investors", "/payments", "/activity"]);

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
  const [linkOpen, setLinkOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      reloadStatus();
    }, 20000);
    return () => window.clearInterval(id);
  }, [reloadStatus]);

  const links = [
    { to: "/", label: "לוח בקרה", end: true, managerOnly: false },
    { to: "/investors", label: isManager ? "משקיעים" : "המסלול שלי", managerOnly: false },
    { to: "/payments", label: isManager ? "תשלומים" : "התשלומים שלי", managerOnly: false },
    { to: "/activity", label: "מעקב", managerOnly: true },
    { to: "/quotes", label: "הצעות", managerOnly: true },
    { to: "/users", label: "משתמשים", managerOnly: true },
    { to: "/settings", label: "הגדרות", managerOnly: true },
  ].filter((l) => !l.managerOnly || isManager);

  const primaryLinks = links.filter((l) => PRIMARY_PATHS.has(l.to));
  const moreLinks = links.filter((l) => !PRIMARY_PATHS.has(l.to));
  const displayName = user?.investor_name || user?.username || "";
  const isAdminAccountUser = isAdminAccount(user);
  const roleLabel = isAdminAccountUser ? "ADMIN" : isManager ? "מנהל" : "משקיע";
  const roleChipClass = isAdminAccountUser
    ? "role-chip role-chip--admin"
    : isManager
      ? "role-chip role-chip--manager"
      : "role-chip role-chip--investor";

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

  function signOut() {
    setMoreOpen(false);
    logout();
    navigate("/login", { replace: true });
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
            <div className="public-link-bar" role="region" aria-label="כניסה מהירה">
              <button
                type="button"
                className="public-link-bar__toggle"
                aria-expanded={linkOpen}
                onClick={() => setLinkOpen((v) => !v)}
              >
                כניסה מהירה
                <span aria-hidden="true">{linkOpen ? "▴" : "▾"}</span>
              </button>
              {linkOpen ? (
                <div className="public-link-bar__panel">
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
                      className="btn btn--small btn--admin"
                      disabled={slackBusy}
                      onClick={sendToSlack}
                    >
                      {slackBusy ? "שולח..." : "שלח ל-Slack"}
                    </button>
                  </div>
                  {slackNote ? <span className="public-link-bar__note">{slackNote}</span> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <header className="topbar">
            <div className="brand">
              <span className="brand__mark">תזרים</span>
              <span className="brand__tag">
                {displayName}
                <span className={roleChipClass}>{roleLabel}</span>
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
            </nav>
            <div className="topbar__tools">
              {isManager ? <NotificationCenter /> : null}
              <button type="button" className="topbar__logout" onClick={signOut}>
                יציאה
              </button>
            </div>
          </header>
        </div>
      </div>

      <div className="app">
        <main className="main">
          <Outlet />
        </main>
      </div>

      <nav className="dock" aria-label="ניווט ראשי בטלפון">
        {primaryLinks.map((link) => (
          <NavLink
            key={`dock-${link.to}`}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? "dock__link is-active" : "dock__link")}
            onClick={() => setMoreOpen(false)}
          >
            {link.label}
          </NavLink>
        ))}
        {moreLinks.length > 0 ? (
          <button
            type="button"
            className={moreOpen ? "dock__link is-active" : "dock__link"}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            עוד
          </button>
        ) : null}
      </nav>

      {moreOpen ? (
        <div className="more-sheet" role="dialog" aria-label="עוד פעולות">
          <button
            type="button"
            className="more-sheet__backdrop"
            aria-label="סגור"
            onClick={() => setMoreOpen(false)}
          />
          <div className="more-sheet__panel">
            <p className="more-sheet__title">עוד</p>
            {moreLinks.map((link) => (
              <NavLink
                key={`more-${link.to}`}
                to={link.to}
                className="more-sheet__link"
                onClick={() => setMoreOpen(false)}
              >
                {link.label}
              </NavLink>
            ))}
            <button type="button" className="more-sheet__link more-sheet__link--danger" onClick={signOut}>
              יציאה
            </button>
          </div>
        </div>
      ) : null}

      <PersonalAssistant />
    </div>
  );
}
