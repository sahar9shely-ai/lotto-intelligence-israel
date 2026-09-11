import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { ActivityEvent, ActivitySummary } from "../types/auth";
import { formatDate } from "../utils/format";

const POLL_MS = 3000;
const STORAGE_KEY = "tazrim_activity_seen_login_id";
const SEEN_EVENT_KEY = "tazrim_activity_seen_event_id";

const FILTERS: { id: string; label: string; group?: string }[] = [
  { id: "all", label: "הכול" },
  { id: "login", label: "כניסות", group: "login" },
  { id: "payment", label: "תשלומים", group: "payment" },
  { id: "quote", label: "הצעות", group: "quote" },
  { id: "user", label: "משתמשים", group: "user" },
];

function playLoginChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    /* ignore audio failures */
  }
}

function pushBrowserNotice(ev: ActivityEvent) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(ev.kind === "login" ? "כניסה למערכת · תזרים" : "התראה · תזרים", {
      body: ev.body ? `${ev.title}\n${ev.body}` : ev.title,
      tag: `tazrim-activity-${ev.id}`,
    });
    window.setTimeout(() => n.close(), 8000);
  } catch {
    /* ignore */
  }
}

function severityClass(severity: string) {
  if (severity === "urgent") return "notif-item--urgent";
  if (severity === "warning") return "notif-item--warning";
  if (severity === "success") return "notif-item--success";
  return "notif-item--info";
}

export function kindLabel(kind: string) {
  if (kind === "login") return "כניסה";
  if (kind.startsWith("payment")) return "תשלום";
  if (kind.startsWith("quote")) return "הצעה";
  if (kind.startsWith("topup")) return "מסלול";
  if (kind.startsWith("user")) return "משתמש";
  if (kind.startsWith("password")) return "סיסמה";
  if (kind.startsWith("plan")) return "מסלול";
  if (kind.startsWith("savings")) return "חיסכון";
  if (kind.startsWith("investor")) return "משקיע";
  if (kind.startsWith("settings")) return "הגדרות";
  return "פעילות";
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [toast, setToast] = useState<ActivityEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const seenLoginRef = useRef<number>(
    Number(window.sessionStorage.getItem(STORAGE_KEY) || "0") || 0,
  );
  const seenEventRef = useRef<number>(
    Number(window.sessionStorage.getItem(SEEN_EVENT_KEY) || "0") || 0,
  );
  const primedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  async function refreshSummary(announce = true) {
    try {
      const next = await api.activitySummary();
      const prevLogin = seenLoginRef.current;
      const prevEvent = seenEventRef.current;
      const latestLoginId = next.latest_login_id || 0;
      const latestId = next.latest_id || 0;

      if (announce && primedRef.current && latestLoginId > prevLogin && next.latest_login) {
        setToast(next.latest_login);
        playLoginChime();
        pushBrowserNotice(next.latest_login);
        window.setTimeout(() => setToast(null), 9000);
      } else if (
        announce &&
        primedRef.current &&
        latestId > prevEvent &&
        next.latest &&
        next.latest.kind !== "login" &&
        (next.latest.severity === "urgent" || next.latest.severity === "warning")
      ) {
        setToast(next.latest);
        pushBrowserNotice(next.latest);
        window.setTimeout(() => setToast(null), 7000);
      }

      if (latestLoginId > prevLogin) {
        seenLoginRef.current = latestLoginId;
        window.sessionStorage.setItem(STORAGE_KEY, String(latestLoginId));
      }
      if (latestId > prevEvent) {
        seenEventRef.current = latestId;
        window.sessionStorage.setItem(SEEN_EVENT_KEY, String(latestId));
      }
      primedRef.current = true;
      setSummary(next);
    } catch {
      /* keep prior state */
    }
  }

  async function loadEvents() {
    setLoading(true);
    try {
      const group = FILTERS.find((f) => f.id === filter)?.group;
      const rows = await api.activity({ limit: 50, group });
      setEvents(rows);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshSummary(false);
    let id = 0;
    function tick() {
      if (document.visibilityState === "visible") {
        void refreshSummary(true);
      }
    }
    id = window.setInterval(tick, POLL_MS);
    function onVis() {
      if (document.visibilityState === "visible") void refreshSummary(true);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadEvents();
    void refreshSummary(false);
  }, [open, filter]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const id = window.setTimeout(() => {
      document.addEventListener("click", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = summary?.unread_count ?? 0;
  const unreadLogins = summary?.unread_login_count ?? 0;

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className={`notif__bell${unreadLogins > 0 ? " notif__bell--pulse" : ""}`}
        aria-expanded={open}
        aria-label={unread > 0 ? `התראות · ${unread} שלא נקראו` : "התראות"}
        onClick={() => {
          setOpen((v) => !v);
          if ("Notification" in window && Notification.permission === "default") {
            void Notification.requestPermission();
          }
        }}
      >
        <span className="notif__bell-icon" aria-hidden="true">
          ●
        </span>
        <span className="notif__bell-label">מעקב</span>
        {unread > 0 ? <span className="notif__badge">{unread > 99 ? "99+" : unread}</span> : null}
      </button>

      {open ? (
        <div className="notif__panel" role="dialog" aria-label="מרכז התראות">
          <div className="notif__head">
            <div>
              <strong>מרכז מעקב</strong>
              <span className="muted">
                {unreadLogins > 0
                  ? `${unreadLogins} כניסות חדשות`
                  : unread > 0
                    ? `${unread} התראות ממתינות`
                    : "הכול מעודכן"}
              </span>
            </div>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={async () => {
                await api.markAllActivityRead();
                await refreshSummary(false);
                await loadEvents();
              }}
            >
              סמן הכל כנקרא
            </button>
          </div>

          <div className="notif__filters" role="tablist" aria-label="סינון התראות">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`notif__filter${filter === f.id ? " is-active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {f.group && summary?.unread_by_group?.[f.group]
                  ? ` · ${summary.unread_by_group[f.group]}`
                  : ""}
              </button>
            ))}
          </div>

          {loading ? <p className="muted notif__empty">טוען פעילות…</p> : null}
          {!loading && events.length === 0 ? (
            <p className="muted notif__empty">אין אירועים בקטגוריה זו</p>
          ) : null}

          <ul className="notif__list">
            {events.map((ev) => (
              <li
                key={ev.id}
                className={`notif-item ${severityClass(ev.severity)}${ev.is_unread ? " is-unread" : ""}`}
              >
                <div className="notif-item__meta">
                  <span className="notif-item__kind">{kindLabel(ev.kind)}</span>
                  <time dateTime={ev.created_at}>{formatDate(ev.created_at)}</time>
                </div>
                <strong className="notif-item__title">{ev.title}</strong>
                {ev.body ? <p className="notif-item__body">{ev.body}</p> : null}
                <div className="notif-item__actions">
                  {ev.href ? (
                    <Link className="btn btn--small btn--ghost" to={ev.href} onClick={() => setOpen(false)}>
                      פתיחה
                    </Link>
                  ) : null}
                  {ev.is_unread ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={async () => {
                        await api.markActivityRead(ev.id);
                        await refreshSummary(false);
                        await loadEvents();
                      }}
                    >
                      נקרא
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="notif__footer">
            <Link className="text-link" to="/activity" onClick={() => setOpen(false)}>
              יומן מעקב מלא ←
            </Link>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`notif-toast${toast.kind === "login" ? " notif-toast--login" : ""}`}
          role="status"
        >
          <div>
            <strong>{toast.kind === "login" ? "כניסה למערכת עכשיו" : "התראה חדשה"}</strong>
            <p>{toast.title}</p>
            {toast.body ? <span className="muted">{toast.body}</span> : null}
          </div>
          <div className="notif-toast__actions">
            {toast.href ? (
              <Link className="btn btn--small" to={toast.href} onClick={() => setToast(null)}>
                פתיחה
              </Link>
            ) : null}
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setToast(null)}>
              סגור
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
