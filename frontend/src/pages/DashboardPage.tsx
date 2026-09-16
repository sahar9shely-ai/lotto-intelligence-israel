import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardUrgentOps } from "../components/DashboardUrgentOps";
import { InvestorHeroCard } from "../components/InvestorHeroCard";
import { ManagerIncomePanel } from "../components/ManagerIncomePanel";
import { Panel } from "../components/Panel";
import { PaymentCeremonyCard } from "../components/PaymentCeremonyCard";
import { ScrollReveal } from "../components/motion/ScrollReveal";
import { Stat } from "../components/Stat";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate, formatMoney, formatPercent, statusLabel } from "../utils/format";
import { downloadMonthlyReportPdf } from "../utils/monthlyReportPdf";
import { isAdminAccount, isAdminShellInvestor } from "../utils/roles";

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

  const showOpsFeed = isManager && !isAdmin;

  const {
    data: alerts,
    reload: reloadAlerts,
  } = useAsync(() => (showOpsFeed ? api.loginAlerts(true) : Promise.resolve([])), [showOpsFeed]);

  const {
    data: activity,
    reload: reloadActivity,
  } = useAsync(
    () => (showOpsFeed ? api.activity({ limit: 25 }) : Promise.resolve([])),
    [showOpsFeed],
  );

  const { data: topupRequests } = useAsync(() => api.topupRequests(), []);
  const { data: investorPayments, reload: reloadInvestorPayments } = useAsync(
    () => (isManager ? Promise.resolve([]) : api.payments({ year: new Date().getFullYear() })),
    [isManager],
  );
  const [monthlyBusy, setMonthlyBusy] = useState(false);
  const [dashMessage, setDashMessage] = useState<string | null>(null);
  const [ceremonyBusyId, setCeremonyBusyId] = useState<number | null>(null);

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

  const dashboard = data;
  const cash = dashboard.monthly_cash_payouts ?? dashboard.monthly_investor_payouts;
  const savings = dashboard.monthly_savings_accruals ?? 0;
  const savingsBalance = dashboard.current_savings_total ?? 0;
  const scopeName =
    filterId != null
      ? investors?.find((i) => i.id === filterId)?.name ?? "משקיע"
      : null;
  const investorScopeOptions = (investors ?? []).filter((inv) => !isAdminShellInvestor(inv));
  const awaitingPayments = (investorPayments ?? []).filter(
    (p) => p.status === "awaiting_confirmation",
  );
  const nextPayment =
    awaitingPayments[0] ??
    dashboard.upcoming_payments.find((p) => p.status === "awaiting_confirmation") ??
    dashboard.upcoming_payments[0] ??
    null;

  async function downloadMonthly() {
    setMonthlyBusy(true);
    setDashMessage(null);
    try {
      const yearPays =
        investorPayments ?? (await api.payments({ year: new Date().getFullYear() }));
      await downloadMonthlyReportPdf({
        dashboard,
        payments: yearPays,
        investorName: user?.investor_name || user?.username || "תיק פרטי",
      });
      setDashMessage("הדוח החודשי ירד בהצלחה");
    } catch (err) {
      setDashMessage(err instanceof Error ? err.message : "הורדת הדוח נכשלה");
    } finally {
      setMonthlyBusy(false);
    }
  }

  async function confirmReceived(id: number) {
    setCeremonyBusyId(id);
    setDashMessage(null);
    try {
      await api.confirmPayment(id);
      setDashMessage("רשמנו שקיבלת את ההעברה");
      reload();
      reloadInvestorPayments();
    } catch (err) {
      setDashMessage(err instanceof Error ? err.message : "אישור ההעברה נכשל");
    } finally {
      setCeremonyBusyId(null);
    }
  }

  async function markNotYet(id: number) {
    setCeremonyBusyId(id);
    setDashMessage(null);
    try {
      await api.rejectPayment(id);
      setDashMessage("ציינו שעדיין לא הגיע — נבדוק ונחזור אליך");
      reload();
      reloadInvestorPayments();
    } catch (err) {
      setDashMessage(err instanceof Error ? err.message : "עדכון הסטטוס נכשל");
    } finally {
      setCeremonyBusyId(null);
    }
  }

  return (
    <div className={`page${!isManager ? " page--investor-home" : ""}`}>
      <Toast message={dashMessage} onClear={() => setDashMessage(null)} />
      {isManager ? (
        <ScrollReveal>
          <header className={`page-intro${isAdmin ? " page-intro--admin" : ""}`}>
            <div>
              <h1 className="page-intro__title">
                {isAdmin
                  ? scopeName
                    ? `החזר חודשי · ${scopeName}`
                    : "לוח בקרה"
                  : `שלום ${user?.investor_name || user?.username || ""}`}
              </h1>
            </div>
            <div className="page-head__actions hide-on-phone">
              <Link className="btn btn--admin" to="/investors">
                למשקיעים
              </Link>
              <Link className="btn btn--ghost" to="/payments">
                תשלומים
              </Link>
            </div>
          </header>
        </ScrollReveal>
      ) : (
        <div className="investor-home-stage">
          <InvestorHeroCard
            greeting={user?.investor_name || user?.username || ""}
            principal={data.total_principal}
            nextPayment={nextPayment}
            paidThisYear={data.ytd_investor_paid}
            onDownloadMonthly={() => void downloadMonthly()}
            monthlyBusy={monthlyBusy}
          />
        </div>
      )}

      {!isManager ? (
        <ScrollReveal>
          <PaymentCeremonyCard
            payments={awaitingPayments}
            busyId={ceremonyBusyId}
            onReceived={(id) => void confirmReceived(id)}
            onNotYet={(id) => void markNotYet(id)}
          />
        </ScrollReveal>
      ) : null}

      {isManager ? (
        <ScrollReveal>
          <DashboardUrgentOps investorId={filterId} />
        </ScrollReveal>
      ) : null}

      {(topupRequests ?? []).some(
        (r) => r.status === "pending" || r.status === "contract" || r.can_reverse_investment,
      ) ? (
        <ScrollReveal>
        <Panel
          title={isManager ? "בקשות מסלול" : "הוסף מסלול"}
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
        </ScrollReveal>
      ) : null}

      {isManager && investorScopeOptions.length > 0 ? (
        <ScrollReveal className="scope-bar" role="tablist" aria-label="סינון סיכום">
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
        </ScrollReveal>
      ) : null}

      {isAdmin ? (
        <ScrollReveal>
          <ManagerIncomePanel variant="admin" investorId={filterId} />
        </ScrollReveal>
      ) : (
        <>
      {!isManager ? (
        <p className="ledger-kicker">פירוט המסלול — מזומן וחיסכון בנפרד</p>
      ) : null}
      <ScrollReveal className={`money-ledger${!isManager ? " money-ledger--with-hero money-ledger--secondary" : ""}`}>
        <div className="money-ledger__item money-ledger__item--accent">
          <span>{isManager && !scopeName ? "סך קרן פעילה" : "קרן"}</span>
          <strong>{formatMoney(data.total_principal)}</strong>
          <em>{data.active_plans} מסלולים פעילים</em>
        </div>
        <div className="money-ledger__item">
          <span className="ledger-label">
            <span className="ledger-label__full">החזר חודשי (מזומן)</span>
            <span className="ledger-label__short">החזר חודשי</span>
          </span>
          <strong>{formatMoney(cash)}</strong>
          <em>משולם כל חודש</em>
        </div>
        <div className="money-ledger__item">
          <span className="ledger-label">
            <span className="ledger-label__full">צבירת חיסכון חודשית</span>
            <span className="ledger-label__short">חיסכון חודשי</span>
          </span>
          <strong>{formatMoney(savings)}</strong>
          <em>לא מזומן — נצבר בנפרד</em>
        </div>
        <div className="money-ledger__item">
          <span className="ledger-label">
            <span className="ledger-label__full">יתרת חיסכון כעת</span>
            <span className="ledger-label__short">יתרת חיסכון</span>
          </span>
          <strong>{formatMoney(savingsBalance)}</strong>
          {(data.projected_savings_total ?? 0) > 0 ? (
            <em>צפי לסיום {formatMoney(data.projected_savings_total ?? 0)}</em>
          ) : null}
        </div>
        <div className="money-ledger__item money-ledger__item--total">
          <span className="ledger-label">
            <span className="ledger-label__full">סה״כ חודשי (מזומן + חיסכון)</span>
            <span className="ledger-label__short">סה״כ חודשי</span>
          </span>
          <strong>{formatMoney(data.monthly_investor_total ?? cash + savings)}</strong>
          <em>
            מזומן {formatMoney(cash)} + חיסכון {formatMoney(savings)}
          </em>
        </div>
      </ScrollReveal>

      {isManager && filterId == null && !isAdmin ? (
        <ScrollReveal className="stats-grid stats-grid--compact hide-on-phone">
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
        </ScrollReveal>
      ) : null}

      {isManager && filterId == null && !isAdmin ? (
        <ScrollReveal>
          <ManagerIncomePanel />
        </ScrollReveal>
      ) : null}
        </>
      )}

      {showOpsFeed ? (
        <ScrollReveal>
        <Panel
          className="hide-on-phone"
          title="יומן מעקב"
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
        </ScrollReveal>
      ) : null}

      {showOpsFeed && (alerts?.length ?? 0) > 0 ? (
        <ScrollReveal>
        <Panel
          title="התראות כניסה"
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
        </ScrollReveal>
      ) : null}

      {!isAdmin ? (
      <ScrollReveal className="grid-2" delay={80}>
        {isManager ? (
          <Panel
            title={scopeName ? `פירוט · ${scopeName}` : "משקיעים"}
            action={
              <Link className="text-link" to="/investors">
                כרטיסים מלאים
              </Link>
            }
            delay={80}
          >
            {data.investors_summary.filter((inv) => !isAdminShellInvestor(inv)).length === 0 ? (
              <div className="empty-block">
                <p className="empty">עדיין אין משקיעים.</p>
                <Link className="btn btn--small btn--primary" to="/investors">
                  הוסף משקיע
                </Link>
              </div>
            ) : (
              <ul className="list">
                {data.investors_summary
                  .filter((inv) => !isAdminShellInvestor(inv))
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
        ) : (
          <Panel className="home-card home-card--summary" title="הסיכום שלך" delay={80}>
            <ul className="list">
              {data.investors_summary.map((inv) => (
                <li key={inv.id} className="list__row">
                  <div>
                    <strong>{inv.name}</strong>
                    <span className="muted">{inv.months_in_program} חודשים בתוכנית</span>
                  </div>
                  <div className="list__meta">
                    <span className="investor-summary__principal">{formatMoney(inv.active_principal)}</span>
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
        )}

        <Panel
          className="home-card home-card--upcoming"
          title="תשלומים קרובים"
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
      </ScrollReveal>
      ) : null}

      {!isAdmin ? (
      <ScrollReveal delay={200}>
      <Panel
        className="home-card home-card--yearly"
        title="סיכום שנתי וסה״כ"
        delay={200}
      >
        <div className="stats-grid stats-grid--compact">
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
        ) : (
          <p className="empty">אין תשלומים אחרונים להצגה.</p>
        )}
      </Panel>
      </ScrollReveal>
      ) : null}
    </div>
  );
}
