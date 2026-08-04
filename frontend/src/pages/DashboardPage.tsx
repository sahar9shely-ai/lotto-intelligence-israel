import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { Stat } from "../components/Stat";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate, formatMoney, statusLabel } from "../utils/format";

export function DashboardPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const { data, error, loading, reload } = useAsync(() => api.dashboard(), []);
  const {
    data: alerts,
    reload: reloadAlerts,
  } = useAsync(() => (isManager ? api.loginAlerts(true) : Promise.resolve([])), [isManager]);

  if (loading) return <div className="state">טוען את לוח הבקרה...</div>;
  if (error || !data)
    return (
      <div className="state state--error">
        <p>{error ?? "לא ניתן לטעון"}</p>
        <button type="button" className="btn" onClick={reload}>
          נסי שוב
        </button>
      </div>
    );

  return (
    <div className="page">
      <section className="hero">
        <p className="hero__eyebrow">
          {isManager ? "ניהול שותפים · תשואה חודשית קבועה" : `שלום ${user?.investor_name}`}
        </p>
        <h1 className="hero__brand">תזרים</h1>
        <p className="hero__lead">
          {isManager
            ? "מעקב מסודר אחר קרנות המשקיעים, תשלומים חודשיים, עמלת ניהול נפרדת והצעות למשקיעים חדשים."
            : "כאן מוצגים רק הנתונים של המסלול שלך — קרן, תשלומים והיסטוריה."}
        </p>
        <div className="hero__actions">
          <Link className="btn btn--primary" to="/investors">
            {isManager ? "למשקיעים" : "המסלול שלי"}
          </Link>
          {isManager ? (
            <Link className="btn btn--ghost" to="/quotes">
              הצעה חדשה
            </Link>
          ) : (
            <Link className="btn btn--ghost" to="/payments">
              התשלומים שלי
            </Link>
          )}
        </div>
      </section>

      {isManager && (alerts?.length ?? 0) > 0 ? (
        <Panel
          title="התראות כניסה"
          subtitle="מישהו התחבר למערכת"
          action={
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={async () => {
                await api.markAllAlertsRead();
                reloadAlerts();
              }}
            >
              סמני הכל כנקרא
            </button>
          }
        >
          <ul className="list">
            {(alerts ?? []).map((a) => (
              <li key={a.id} className="list__row">
                <div>
                  <strong>{a.display_name} התחבר/ה</strong>
                  <span className="muted">
                    {a.email} · {formatDate(a.logged_in_at)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={async () => {
                    await api.markAlertRead(a.id);
                    reloadAlerts();
                  }}
                >
                  נקרא
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="stats-grid">
        <Stat
          label={isManager ? "סך קרן פעילה" : "הקרן שלי"}
          value={formatMoney(data.total_principal)}
          tone="accent"
        />
        <Stat
          label={isManager ? "תשלומים חודשיים למשקיעים" : "תשלום חודשי שלי"}
          value={formatMoney(data.monthly_investor_payouts)}
        />
        {isManager ? (
          <>
            <Stat
              label="עמלת ניהול חודשית"
              value={formatMoney(data.monthly_manager_fees)}
              hint="בנוסף — לא נגזר מהמשקיעים"
              tone="manager"
            />
            <Stat
              label="סה״כ חודשי למנהלת"
              value={formatMoney(data.monthly_manager_total)}
              hint={`השקעה עצמית ${formatMoney(data.monthly_manager_own_payout)} + עמלה`}
              tone="manager"
            />
          </>
        ) : (
          <>
            <Stat label="מסלולים פעילים" value={String(data.active_plans)} />
            <Stat label="שולם YTD" value={formatMoney(data.ytd_investor_paid)} />
          </>
        )}
      </div>

      <div className="grid-2">
        {isManager ? (
          <Panel
            title="משקיעים"
            subtitle={`${data.active_plans} מסלולים פעילים`}
            action={
              <Link className="text-link" to="/investors">
                הכל
              </Link>
            }
            delay={80}
          >
            <ul className="list">
              {data.investors_summary.map((inv) => (
                <li key={inv.id} className="list__row">
                  <div>
                    <strong>
                      {inv.name}
                      {inv.is_manager ? <span className="chip">מנהלת</span> : null}
                    </strong>
                    <span className="muted">
                      {inv.months_in_program} חודשים בתוכנית · {inv.plans_count} מסלולים
                    </span>
                  </div>
                  <div className="list__meta">
                    <span>{formatMoney(inv.active_principal)}</span>
                    <span className="muted">{formatMoney(inv.monthly_payout)} / חודש</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <Panel title="הסיכום שלי" subtitle="רק הנתונים שלך" delay={80}>
            <ul className="list">
              {data.investors_summary.map((inv) => (
                <li key={inv.id} className="list__row">
                  <div>
                    <strong>{inv.name}</strong>
                    <span className="muted">{inv.months_in_program} חודשים בתוכנית</span>
                  </div>
                  <div className="list__meta">
                    <span>{formatMoney(inv.active_principal)}</span>
                    <span className="muted">{formatMoney(inv.monthly_payout)} / חודש</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel
          title="תשלומים קרובים"
          subtitle="מתוכננים לפי לוח הזמנים"
          action={
            <Link className="text-link" to="/payments">
              היסטוריה
            </Link>
          }
          delay={140}
        >
          {data.upcoming_payments.length === 0 ? (
            <p className="empty">אין תשלומים מתוכננים כרגע.</p>
          ) : (
            <ul className="list">
              {data.upcoming_payments.map((p) => (
                <li key={p.id} className="list__row">
                  <div>
                    <strong>
                      {isManager ? `${p.investor_name} · ` : ""}חודש {p.month_number}
                    </strong>
                    <span className="muted">{formatDate(p.due_date)}</span>
                  </div>
                  <div className="list__meta">
                    <span>{formatMoney(p.investor_amount)}</span>
                    {isManager ? (
                      <span className="muted">עמלה {formatMoney(p.manager_amount)}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="סיכום שנתי עד כה" subtitle="מה ששולם בפועל מתחילת השנה" delay={200}>
        <div className="stats-grid stats-grid--compact">
          <Stat
            label={isManager ? "שולם למשקיעים YTD" : "שולם לי YTD"}
            value={formatMoney(data.ytd_investor_paid)}
          />
          {isManager ? (
            <Stat
              label="עמלות ניהול שהתקבלו YTD"
              value={formatMoney(data.ytd_manager_earned)}
              tone="manager"
            />
          ) : null}
          <Stat label="מסלולים פעילים" value={String(data.active_plans)} />
        </div>
        {data.recent_payments.length > 0 ? (
          <ul className="list list--tight">
            {data.recent_payments.map((p) => (
              <li key={p.id} className="list__row">
                <div>
                  <strong>
                    {isManager ? `${p.investor_name} · ` : ""}
                    {statusLabel(p.status)}
                  </strong>
                  <span className="muted">{formatDate(p.paid_at ?? p.due_date)}</span>
                </div>
                <span>{formatMoney(p.investor_amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}
