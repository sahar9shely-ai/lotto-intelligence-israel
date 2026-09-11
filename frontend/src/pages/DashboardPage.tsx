import { useState } from "react";
import { Link } from "react-router-dom";
import { ManagerIncomePanel } from "../components/ManagerIncomePanel";
import { Panel } from "../components/Panel";
import { RoleJourneyHub } from "../components/RoleJourneyHub";
import { Stat } from "../components/Stat";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate, formatMoney, formatPercent, statusLabel } from "../utils/format";
import { isAdminAccount } from "../utils/roles";

export function DashboardPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const isAdmin = isAdminAccount(user);
  const [filterId, setFilterId] = useState<number | null>(null);

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );

  const { data, error, loading, reload } = useAsync(
    () => api.dashboard(isManager && filterId != null ? { investor_id: filterId } : undefined),
    [isManager, filterId],
  );

  const {
    data: alerts,
    reload: reloadAlerts,
  } = useAsync(() => (isManager ? api.loginAlerts(true) : Promise.resolve([])), [isManager]);

  const {
    data: activity,
    reload: reloadActivity,
  } = useAsync(
    () => (isManager ? api.activity({ limit: 25 }) : Promise.resolve([])),
    [isManager],
  );

  const { data: topupRequests } = useAsync(() => api.topupRequests(), []);

  const { data: quotes } = useAsync(
    () => (isManager ? api.quotes() : Promise.resolve([])),
    [isManager],
  );

  if (loading) return <div className="state state--loading">טוען את לוח הבקרה...</div>;
  if (error || !data)
    return (
      <div className="state state--error">
        <p>{error ?? "לא ניתן לטעון"}</p>
        <button type="button" className="btn" onClick={reload}>
          נסה שוב
        </button>
      </div>
    );

  const cash = data.monthly_cash_payouts ?? data.monthly_investor_payouts;
  const savings = data.monthly_savings_accruals ?? 0;
  const savingsBalance = data.current_savings_total ?? 0;
  const scopeName =
    filterId != null
      ? investors?.find((i) => i.id === filterId)?.name ?? "משקיע"
      : null;
  const investorScopeOptions = (investors ?? []).filter((inv) => !inv.is_manager);

  return (
    <div className="page">
      <header
        className={`page-intro${isAdmin ? " page-intro--admin" : ""}${
          !isManager ? " page-intro--investor" : ""
        }`}
      >
        <div>
          {isManager ? (
            <p className="page-intro__eyebrow">
              {isAdmin ? "ADMIN · ניהול" : "ניהול שותפים"}
            </p>
          ) : (
            <p className="page-intro__eyebrow">החשבון שלי</p>
          )}
          <h1 className="page-intro__title">
            {isAdmin
              ? scopeName
                ? `רווח חודשי · ${scopeName}`
                : "רווח חודשי ממשקיעים"
              : `שלום ${user?.investor_name || user?.username || ""}`}
          </h1>
          {isManager ? (
            <p className="page-intro__lead">
              {isAdmin
                ? scopeName
                  ? `עמלת ניהול חודשית מ${scopeName} — לפי מסלולים פעילים.`
                  : "סיכום עמלות ניהול מכל המשקיעים — רווח חודשי ברור לפי שותף."
                : scopeName
                  ? `סיכום של ${scopeName} — מזומן וחיסכון בנפרד.`
                  : "סיכום כולם — מזומן וחיסכון בנפרד. לחצו על משקיע ברשימה כדי לצמצם."}
            </p>
          ) : (
            <p className="page-intro__lead">
              יתרות, תשלומים לאישור והיסטוריה — הכל במבט אחד.
            </p>
          )}
        </div>
        {isManager ? (
          <div className="page-head__actions">
            <Link className="btn btn--admin" to="/investors">
              למשקיעים
            </Link>
            <Link className="btn btn--ghost" to="/payments">
              תשלומים
            </Link>
          </div>
        ) : (
          <div className="page-head__actions">
            <Link className="btn btn--primary" to="/payments">
              לתשלומים
            </Link>
          </div>
        )}
      </header>

      {!isManager ? (
        <div className="investor-quick-balance" aria-label="סיכום חודשי">
          <span>סה״כ חודשי (מזומן + חיסכון)</span>
          <strong>{formatMoney(data.monthly_investor_total ?? cash + savings)}</strong>
          <em>
            מזומן {formatMoney(cash)} · חיסכון {formatMoney(savings)}
          </em>
        </div>
      ) : null}

      {isManager ? (
        <RoleJourneyHub
          isAdmin={isAdmin}
          isManager={isManager}
          dashboard={data}
          topupRequests={topupRequests}
          quotes={quotes}
        />
      ) : null}

      {(topupRequests ?? []).some(
        (r) => r.status === "pending" || r.status === "contract" || r.can_reverse_investment,
      ) ? (
        <Panel
          title={isManager ? "בקשות מסלול" : "הוסף מסלול"}
          subtitle={
            (topupRequests ?? []).some((r) => r.status === "pending" || r.status === "contract")
              ? isManager
                ? "יש בקשות ממתינות לחוזה או לחתימה"
                : "עקבו אחרי הסטטוס, חתמו על החוזה והורידו את הקובץ"
              : "יש השקעה בחלון ביטול של 3 ימי עסקים"
          }
          action={
            <Link className="btn btn--small btn--primary" to="/investors">
              {isManager ? "לטיפול בבקשות" : "לפרטים"}
            </Link>
          }
        >
          <ul className="list">
            {(topupRequests ?? [])
              .filter(
                (r) =>
                  r.status === "pending" || r.status === "contract" || r.can_reverse_investment,
              )
              .slice(0, 6)
              .map((r) => (
                <li key={r.id} className="list__row">
                  <div>
                    <strong>
                      {isManager ? `${r.investor_name} · ` : ""}
                      {formatMoney(r.amount)}
                    </strong>
                    <span className="muted">
                      {statusLabel(r.status)}
                      {r.can_reverse_investment && r.cooling_off_days_left
                        ? ` · ביטול עד ${r.cooling_off_days_left === 1 ? "יום עסקים אחד" : `${r.cooling_off_days_left} ימי עסקים`}`
                        : ""}
                    </span>
                  </div>
                  <span className={`badge badge--${r.status}`}>{statusLabel(r.status)}</span>
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}

      {isManager && investorScopeOptions.length > 0 ? (
        <div className="scope-bar" role="tablist" aria-label="סינון סיכום">
          <button
            type="button"
            role="tab"
            aria-selected={filterId == null}
            className={filterId == null ? "scope-bar__btn is-active" : "scope-bar__btn"}
            onClick={() => setFilterId(null)}
          >
            {isAdmin ? "כל המשקיעים" : "סה״כ כולם"}
          </button>
          {investorScopeOptions.map((inv) => (
            <button
              key={inv.id}
              type="button"
              role="tab"
              aria-selected={filterId === inv.id}
              className={filterId === inv.id ? "scope-bar__btn is-active" : "scope-bar__btn"}
              onClick={() => setFilterId(inv.id)}
            >
              {inv.name}
            </button>
          ))}
        </div>
      ) : null}

      {isAdmin ? (
        <ManagerIncomePanel variant="admin" investorId={filterId} />
      ) : (
        <>
      <div className="money-ledger">
        <div className="money-ledger__item money-ledger__item--accent">
          <span>{isManager && !scopeName ? "סך קרן פעילה" : "קרן"}</span>
          <strong>{formatMoney(data.total_principal)}</strong>
          <em>{data.active_plans} מסלולים פעילים</em>
        </div>
        <div className="money-ledger__item">
          <span>החזר חודשי (מזומן)</span>
          <strong>{formatMoney(cash)}</strong>
          <em>משולם כל חודש</em>
        </div>
        <div className="money-ledger__item">
          <span>צבירת חיסכון חודשית</span>
          <strong>{formatMoney(savings)}</strong>
          <em>לא מזומן — נצבר בנפרד</em>
        </div>
        <div className="money-ledger__item">
          <span>יתרת חיסכון כעת</span>
          <strong>{formatMoney(savingsBalance)}</strong>
          {(data.projected_savings_total ?? 0) > 0 ? (
            <em>צפי לסיום {formatMoney(data.projected_savings_total ?? 0)}</em>
          ) : null}
        </div>
        <div className="money-ledger__item money-ledger__item--total">
          <span>סה״כ חודשי (מזומן + חיסכון)</span>
          <strong>{formatMoney(data.monthly_investor_total ?? cash + savings)}</strong>
          <em>
            מזומן {formatMoney(cash)} + חיסכון {formatMoney(savings)}
          </em>
        </div>
      </div>

      {isManager && filterId == null && !isAdmin ? (
        <div className="stats-grid stats-grid--compact">
          <Stat
            label="עמלת ניהול חודשית"
            value={formatMoney(data.monthly_manager_fees)}
            hint="נוספת — לא מהמשקיעים"
            tone="manager"
          />
          <Stat
            label="סה״כ חודשי למנהל"
            value={formatMoney(data.monthly_manager_total)}
            hint={`השקעה עצמית ${formatMoney(data.monthly_manager_own_total ?? data.monthly_manager_own_payout)} + עמלה`}
            tone="manager"
          />
        </div>
      ) : null}

      {isManager && filterId == null && !isAdmin ? <ManagerIncomePanel /> : null}
        </>
      )}

      {isManager ? (
        <Panel
          title="יומן מעקב"
          subtitle="כניסות, תשלומים, הצעות ובקשות — הכול במקום אחד"
          action={
            <div className="inline-form">
              <Link className="btn btn--small btn--ghost" to="/activity">
                מעקב מלא
              </Link>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={async () => {
                  await api.markAllActivityRead();
                  reloadActivity();
                  reloadAlerts();
                }}
              >
                סמן הכל כנקרא
              </button>
            </div>
          }
        >
          {(activity?.length ?? 0) === 0 ? (
            <p className="muted">עדיין אין אירועים במעקב</p>
          ) : (
            <ul className="list activity-feed">
              {(activity ?? []).map((ev) => (
                <li
                  key={ev.id}
                  className={`list__row activity-feed__row${ev.is_unread ? " is-unread" : ""}${
                    ev.kind === "login" ? " activity-feed__row--login" : ""
                  }`}
                >
                  <div>
                    <strong>{ev.title}</strong>
                    <span className="muted">
                      {ev.body ? `${ev.body} · ` : ""}
                      {formatDate(ev.created_at)}
                    </span>
                  </div>
                  {ev.is_unread ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={async () => {
                        await api.markActivityRead(ev.id);
                        reloadActivity();
                      }}
                    >
                      נקרא
                    </button>
                  ) : (
                    <span className="muted">נקרא</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

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
              סמן הכל כנקרא
            </button>
          }
        >
          <ul className="list">
            {(alerts ?? []).map((a) => (
              <li key={a.id} className="list__row">
                <div>
                  <strong>{a.display_name} התחבר</strong>
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

      <div className={isAdmin ? "stack" : "grid-2"}>
        {isManager && !isAdmin ? (
          <Panel
            title={scopeName ? `פירוט · ${scopeName}` : "משקיעים"}
            subtitle={`${data.active_plans} מסלולים פעילים`}
            action={
              <Link className="text-link" to="/investors">
                כרטיסים מלאים
              </Link>
            }
            delay={80}
          >
            {data.investors_summary.filter((inv) => !inv.is_manager).length === 0 ? (
              <div className="empty-block">
                <p className="empty">עדיין אין משקיעים.</p>
                <Link className="btn btn--small btn--primary" to="/investors">
                  הוסף משקיע
                </Link>
              </div>
            ) : (
              <ul className="list">
                {data.investors_summary
                  .filter((inv) => !inv.is_manager)
                  .map((inv) => (
                  <li key={inv.id} className="list__row">
                    <button
                      type="button"
                      className="list__pick"
                      onClick={() => setFilterId(inv.id)}
                    >
                      <strong>{inv.name}</strong>
                      <span className="muted">
                        מזומן {formatPercent(inv.cash_rate_percent ?? 0)}
                        {(inv.savings_rate_percent ?? 0) > 0
                          ? ` · חיסכון ${formatPercent(inv.savings_rate_percent ?? 0)}`
                          : ""}
                      </span>
                    </button>
                    <div className="list__meta">
                      <span>{formatMoney(inv.active_principal)}</span>
                      <span className="muted">
                        מזומן {formatMoney(inv.monthly_cash ?? inv.monthly_payout)}
                        {(inv.monthly_savings ?? 0) > 0
                          ? ` · חיסכון ${formatMoney(inv.monthly_savings ?? 0)}`
                          : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : !isManager ? (
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
                    <span className="muted">
                      מזומן {formatMoney(inv.monthly_cash ?? inv.monthly_payout)}
                      {(inv.monthly_savings ?? 0) > 0
                        ? ` · חיסכון ${formatMoney(inv.monthly_savings ?? 0)}`
                        : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel
          title={isAdmin ? "תשלומים קרובים · העמלות שלך" : "תשלומים קרובים"}
          subtitle={
            isAdmin
              ? "עמלת ניהול לפי תשלום מתוכנן"
              : "מזומן בלבד — לפי לוח הזמנים"
          }
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
                    {isAdmin ? (
                      <>
                        <span>{formatMoney(p.manager_amount)}</span>
                        <span className="muted">עמלה · תשלום {formatMoney(p.investor_amount)}</span>
                      </>
                    ) : (
                      <>
                        <span>{formatMoney(p.investor_amount)}</span>
                        {isManager ? (
                          <span className="muted">עמלה {formatMoney(p.manager_amount)}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title={isAdmin ? "סיכום עמלות" : "סיכום שנתי וסה״כ"}
        subtitle={
          isAdmin
            ? "עמלות ניהול ששולמו בפועל"
            : "שולם בפועל במזומן · חיסכון לא נספר כאן כתשלום"
        }
        delay={200}
      >
        <div className="stats-grid stats-grid--compact">
          {isAdmin ? (
            <>
              <Stat label="עמלות השנה" value={formatMoney(data.ytd_manager_earned)} tone="manager" />
              <Stat
                label="סה״כ עמלות"
                value={formatMoney(data.lifetime_manager_earned ?? 0)}
                tone="manager"
              />
              <Stat label="משקיעים פעילים" value={String(data.active_investors)} />
              <Stat label="מסלולים פעילים" value={String(data.active_plans)} />
            </>
          ) : (
            <>
          <Stat
            label={isManager ? "שולם למשקיעים השנה" : "שולם לי השנה"}
            value={formatMoney(data.ytd_investor_paid)}
          />
          {isManager ? (
            <Stat
              label="עמלות השנה"
              value={formatMoney(data.ytd_manager_earned)}
              tone="manager"
            />
          ) : null}
          <Stat
            label={isManager ? "סה״כ שולם למשקיעים" : "סה״כ שולם לי"}
            value={formatMoney(data.lifetime_investor_paid ?? 0)}
          />
          {isManager ? (
            <Stat
              label="סה״כ עמלות"
              value={formatMoney(data.lifetime_manager_earned ?? 0)}
              tone="manager"
            />
          ) : (
            <Stat label="מסלולים פעילים" value={String(data.active_plans)} />
          )}
            </>
          )}
        </div>
        {!isAdmin && data.recent_payments.length > 0 ? (
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
        ) : !isAdmin ? (
          <p className="empty">אין תשלומים אחרונים להצגה.</p>
        ) : null}
      </Panel>
    </div>
  );
}
