import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { ActivityEvent, ActivitySummary } from "../types/auth";
import { formatDate } from "../utils/format";

const POLL_MS = 8000;
const STORAGE_KEY = "tazrim_activity_seen_login_id";

function playLoginChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

function severityClass(severity: string) {
  if (severity === "urgent") return "notif-item--urgent";
  if (severity === "warning") return "notif-item--warning";
  if (severity === "success") return "notif-item--success";
  return "notif-item--info";
}

function kindLabel(kind: string) {
  if (kind === "login") return "כניסה";
  if (kind.startsWith("payment")) return "תשלום";
  if (kind.startsWith("quote")) return "הצעה";
  if (kind.startsWith("topup")) return "מסלול";
  if (kind.startsWith("user")) return "משתמש";
  if (kind.startsWith("password")) return "סיסמה";
  return "פעילות";
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [toast, setToast] = useState<ActivityEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const seenLoginRef = useRef<number>(
    Number(window.sessionStorage.getItem(STORAGE_KEY) || "0") || 0,
  );
  const primedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  async function refreshSummary(announce = true) {
    try {
      const next = await api.activitySummary();
      const prevLogin = seenLoginRef.current;
      const latestLoginId = next.latest_login_id || 0;
      if (announce && primedRef.current && latestLoginId > prevLogin && next.latest_login) {
        setToast(next.latest_login);
        playLoginChime();
        window.setTimeout(() => setToast(null), 7000);
      }
      if (latestLoginId > prevLogin) {
        seenLoginRef.current = latestLoginId;
        window.sessionStorage.setItem(STORAGE_KEY, String(latestLoginId));
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
      const rows = await api.activity({ limit: 40 });
      setEvents(rows);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshSummary(false);
    const id = window.setInterval(() => {
      void refreshSummary(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadEvents();
    void refreshSummary(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
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
        onClick={() => setOpen((v) => !v)}
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

          {loading ? <p className="muted notif__empty">טוען פעילות…</p> : null}
          {!loading && events.length === 0 ? (
            <p className="muted notif__empty">אין אירועים עדיין</p>
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
        </div>
      ) : null}

      {toast ? (
        <div className="notif-toast" role="status">
          <div>
            <strong>כניסה למערכת</strong>
            <p>{toast.title}</p>
            {toast.body ? <span className="muted">{toast.body}</span> : null}
          </div>
          <button type="button" className="btn btn--small" onClick={() => setToast(null)}>
            סגור
          </button>
        </div>
      ) : null}
    </div>
  );
}
