import { PersonalAssistant } from "./PersonalAssistant";
import { NotificationCenter } from "./NotificationCenter";
import { PaymentNudgeDialog } from "./PaymentNudgeDialog";
import { useEffect, useState, type SVGProps } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isAdminAccount } from "../utils/roles";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

function DockGlyph({ path }: { path: string }) {
  const common: SVGProps<SVGSVGElement> = {
    viewBox: "0 0 24 24",
    width: 24,
    height: 24,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (path === "/") {
    return (
      <svg {...common}>
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
      </svg>
    );
  }
  if (path === "/investors") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <circle cx="17" cy="8.5" r="2.4" />
        <path d="M16 14.2a4.8 4.8 0 0 1 5 4.8" />
      </svg>
    );
  }
  if (path === "/payments") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="13" rx="2.2" />
        <path d="M3 10h18" />
        <path d="M8 15h4" />
      </svg>
    );
  }
  if (path === "/activity") {
    return (
      <svg {...common}>
        <path d="M4 13h3l2-6 3 10 2-4h4" />
        <circle cx="19" cy="7" r="2.2" />
      </svg>
    );
  }
  if (path === "/documents") {
    return (
      <svg {...common}>
        <rect x="5" y="3.5" width="14" height="17" rx="2" />
        <path d="M9 8.5h6M9 12.5h6M9 16.5h4" />
      </svg>
    );
  }
  if (path === "/quotes") {
    return (
      <svg {...common}>
        <path d="M7 3.5h8.5L20 8v12.5H7z" />
        <path d="M15.5 3.5V8H20" />
        <path d="M10 12h6M10 16h4" />
      </svg>
    );
  }
  if (path === "/users") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 19.5a7 7 0 0 1 14 0" />
      </svg>
    );
  }
  if (path === "/settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 4.2v1.8M12 18v1.8M4.2 12h1.8M18 12h1.8M6.4 6.4l1.3 1.3M16.3 16.3l1.3 1.3M17.6 6.4l-1.3 1.3M7.7 16.3l-1.3 1.3" />
      </svg>
    );
  }
  if (path === "/change-password") {
    return (
      <svg {...common}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8.2a4 4 0 0 1 8 0V11" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HomeOrbGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={28} height={28} aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.18 3.42a1.35 1.35 0 0 1 1.64 0l7.35 5.72c.48.37.56 1.06.19 1.54-.37.48-1.06.56-1.54.19l-.42-.33v8.66c0 1.02-.83 1.85-1.85 1.85h-3.2v-5.2h-3.7v5.2H6.45c-1.02 0-1.85-.83-1.85-1.85V10.54l-.42.33c-.48.37-1.17.29-1.54-.19-.37-.48-.29-1.17.19-1.54l7.35-5.72Z"
      />
    </svg>
  );
}

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
    { to: "/", label: "לוח בקרה", dockLabel: "לוח", end: true, managerOnly: false },
    {
      to: "/investors",
      label: isManager ? "משקיעים" : "ההשקעה שלי",
      dockLabel: isManager ? "משקיעים" : "השקעה",
      managerOnly: false,
    },
    { to: "/payments", label: "תשלומים", dockLabel: "תשלומים", managerOnly: false },
    { to: "/documents", label: "מסמכים", dockLabel: "מסמכים", managerOnly: false },
    { to: "/activity", label: "מעקב", dockLabel: "מעקב", managerOnly: true },
    { to: "/quotes", label: "הצעות", dockLabel: "הצעות", managerOnly: true },
    { to: "/users", label: "משתמשים", dockLabel: "משתמשים", managerOnly: true },
    { to: "/settings", label: "הגדרות", dockLabel: "הגדרות", managerOnly: true },
  ].filter((l) => !l.managerOnly || isManager);

  const primaryPaths = isManager
    ? new Set(["/", "/investors", "/payments", "/activity"])
    : new Set(["/", "/investors", "/payments", "/documents"]);
  const primaryLinks = links.filter((l) => primaryPaths.has(l.to));
  const moreLinks = links.filter((l) => !primaryPaths.has(l.to));
  const dockSideLinks = primaryLinks.filter((l) => l.to !== "/");
  const dockLeading = dockSideLinks.slice(0, 2);
  const dockTrailing = dockSideLinks.slice(2);
  const displayName = user?.investor_name || user?.username || "";
  const isAdminAccountUser = isAdminAccount(user);
  const roleLabel = isAdminAccountUser ? "מנהל מערכת" : isManager ? "מנהל" : "תיק פרטי";
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
      {isManager && siteStatus?.data_persistent === false ? (
        <div className="site-update-banner site-update-banner--warn" role="status">
          <strong>שמירה זמנית ב־Render</strong>
          <span>
            המשתמשים נשמרים כרגע ב־SQLite על דיסק זמני — סיסמה ושם משתמש נמחקים בכל דיפלוי.
            חברו DATABASE_URL ל־Neon (Postgres) כדי שהשינויים יישארו.
          </span>
        </div>
      ) : null}

      <div className="chrome chrome--quiet" role="banner">
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
                <span className="brand__who">{displayName}</span>
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
        <div className="dock__bar">
          {dockLeading.map((link) => (
            <NavLink
              key={`dock-${link.to}`}
              to={link.to}
              className={({ isActive }) => (isActive ? "dock__link is-active" : "dock__link")}
              onClick={() => setMoreOpen(false)}
            >
              <DockGlyph path={link.to} />
              <span>{link.dockLabel}</span>
            </NavLink>
          ))}
          <span className="dock__home-slot" aria-hidden="true" />
          {dockTrailing.map((link) => (
            <NavLink
              key={`dock-${link.to}`}
              to={link.to}
              className={({ isActive }) => (isActive ? "dock__link is-active" : "dock__link")}
              onClick={() => setMoreOpen(false)}
            >
              <DockGlyph path={link.to} />
              <span>{link.dockLabel}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={moreOpen ? "dock__link is-active" : "dock__link"}
            aria-expanded={moreOpen}
            aria-controls="more-sheet"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <DockGlyph path="more" />
            <span>עוד</span>
          </button>
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "dock__home is-active" : "dock__home")}
            aria-label="לוח"
            title="לוח"
            onClick={() => setMoreOpen(false)}
          >
            <HomeOrbGlyph />
          </NavLink>
        </div>
      </nav>

      {moreOpen ? (
        <div className="more-sheet" id="more-sheet" role="dialog" aria-label="עוד פעולות">
          <button
            type="button"
            className="more-sheet__backdrop"
            aria-label="סגור"
            onClick={() => setMoreOpen(false)}
          />
          <div className="more-sheet__panel">
            <p className="more-sheet__title">עוד פעולות</p>
            {moreLinks.map((link) => (
              <NavLink
                key={`more-${link.to}`}
                to={link.to}
                className="more-sheet__link"
                onClick={() => setMoreOpen(false)}
              >
                <DockGlyph path={link.to} />
                <span>{link.label}</span>
              </NavLink>
            ))}
            <NavLink
              to="/change-password"
              className="more-sheet__link"
              onClick={() => setMoreOpen(false)}
            >
              <DockGlyph path="/change-password" />
              <span>החלפת סיסמה</span>
            </NavLink>
            <button type="button" className="more-sheet__link more-sheet__link--danger" onClick={signOut}>
              <span>יציאה מהחשבון</span>
            </button>
          </div>
        </div>
      ) : null}

      <PersonalAssistant />
      <PaymentNudgeDialog />
    </div>
  );
}
