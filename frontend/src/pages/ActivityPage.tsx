import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { kindLabel } from "../components/NotificationCenter";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { ActivityEvent } from "../types/auth";
import { formatDate } from "../utils/format";

const GROUPS: { id: string; label: string; group?: string }[] = [
  { id: "all", label: "הכול" },
  { id: "login", label: "כניסות", group: "login" },
  { id: "payment", label: "תשלומים", group: "payment" },
  { id: "quote", label: "הצעות", group: "quote" },
  { id: "topup", label: "בקשות מסלול", group: "topup" },
  { id: "plan", label: "מסלולים", group: "plan" },
  { id: "savings", label: "חיסכון", group: "savings" },
  { id: "investor", label: "משקיעים", group: "investor" },
  { id: "user", label: "משתמשים וסיסמאות", group: "user" },
  { id: "settings", label: "הגדרות", group: "settings" },
];

function severityClass(severity: string) {
  if (severity === "urgent") return "activity-page__row--urgent";
  if (severity === "warning") return "activity-page__row--warning";
  if (severity === "success") return "activity-page__row--success";
  return "";
}

export function ActivityPage() {
  const [groupId, setGroupId] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const group = GROUPS.find((g) => g.id === groupId)?.group;

  const {
    data: events,
    loading,
    error,
    reload,
  } = useAsync(
    () =>
      api.activity({
        limit: 200,
        group,
        unreadOnly,
      }),
    [groupId, unreadOnly],
  );

  const { data: summary, reload: reloadSummary } = useAsync(() => api.activitySummary(), []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        reload();
        reloadSummary();
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [reload, reloadSummary]);

  async function markRead(ev: ActivityEvent) {
    await api.markActivityRead(ev.id);
    reload();
    reloadSummary();
  }

  async function markAll() {
    await api.markAllActivityRead(group ? { group } : undefined);
    reload();
    reloadSummary();
  }

  const unread = summary?.unread_count ?? 0;
  const unreadLogins = summary?.unread_login_count ?? 0;

  return (
    <div className="activity-page stack">
      <header className="activity-page__hero">
        <div>
          <p className="eyebrow">מעקב מלא</p>
          <h1>יומן פעילות והתראות</h1>
          <p className="lede">
            כל כניסה, תשלום, הצעה, מסלול ושינוי במערכת — במקום אחד. התראות כניסה מופיעות מיד
            גם בפעמון למעלה.
          </p>
        </div>
        <div className="activity-page__stats">
          <div>
            <strong>{unread}</strong>
            <span>לא נקראו</span>
          </div>
          <div className={unreadLogins > 0 ? "is-hot" : undefined}>
            <strong>{unreadLogins}</strong>
            <span>כניסות חדשות</span>
          </div>
        </div>
      </header>

      <Panel
        title="סינון"
        subtitle="בחרו קטגוריה או הציגו רק מה שעדיין לא נקרא"
        action={
          <div className="inline-form">
            <label className="check-row">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              רק שלא נקראו
            </label>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => markAll()}>
              סמן הכל כנקרא
            </button>
          </div>
        }
      >
        <div className="activity-page__filters" role="tablist">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={groupId === g.id}
              className={`activity-page__filter${groupId === g.id ? " is-active" : ""}`}
              onClick={() => setGroupId(g.id)}
            >
              {g.label}
              {g.group && summary?.unread_by_group?.[g.group]
                ? ` (${summary.unread_by_group[g.group]})`
                : ""}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title="אירועים"
        subtitle={loading ? "מרענן…" : `${events?.length ?? 0} רשומות`}
        action={
          <button type="button" className="btn btn--small btn--ghost" onClick={() => reload()}>
            רענון
          </button>
        }
      >
        {error ? <p className="error">{error}</p> : null}
        {!loading && (events?.length ?? 0) === 0 ? (
          <p className="muted">אין אירועים בקטגוריה זו</p>
        ) : null}
        <ul className="list activity-page__list">
          {(events ?? []).map((ev) => (
            <li
              key={ev.id}
              className={`list__row activity-page__row ${severityClass(ev.severity)}${
                ev.is_unread ? " is-unread" : ""
              }${ev.kind === "login" ? " activity-page__row--login" : ""}`}
            >
              <div>
                <div className="activity-page__meta">
                  <span className="activity-page__kind">{kindLabel(ev.kind)}</span>
                  <time dateTime={ev.created_at}>{formatDate(ev.created_at)}</time>
                </div>
                <strong>{ev.title}</strong>
                {ev.body ? <span className="muted">{ev.body}</span> : null}
                {ev.actor_name ? (
                  <span className="muted">ביצע: {ev.actor_name}</span>
                ) : null}
              </div>
              <div className="activity-page__actions">
                {ev.href ? (
                  <Link className="btn btn--small btn--ghost" to={ev.href}>
                    פתיחה
                  </Link>
                ) : null}
                {ev.is_unread ? (
                  <button type="button" className="btn btn--small" onClick={() => markRead(ev)}>
                    נקרא
                  </button>
                ) : (
                  <span className="muted">נקרא</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
