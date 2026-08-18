import { FormEvent, useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { PlanStatusReportPanel } from "../components/PlanStatusReportPanel";
import { PlanTrackFields } from "../components/PlanTrackFields";
import { SavingsActions } from "../components/SavingsActions";
import { PlanCoolingOffBanner, TopupRequestsPanel } from "../components/TopupRequestsPanel";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Investor, Plan, Settings } from "../types/investments";
import { formatMoney, formatPercent, yearStartISO } from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";

type Scope = "all" | number;
type TrackView = "active" | "closed";

function cashOf(inv: Investor) {
  return inv.monthly_cash ?? inv.monthly_payout ?? 0;
}

function savingsOf(inv: Investor) {
  return inv.monthly_savings ?? 0;
}

function totalMonthlyOf(inv: Investor) {
  return inv.monthly_total ?? cashOf(inv) + savingsOf(inv);
}

export function InvestorsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const { data: investors, error, loading, reload } = useAsync(() => api.investors(), []);
  const { data: settings } = useAsync(
    () => (isManager ? api.settings() : Promise.resolve(null)),
    [isManager],
  );
  const { data: plans, reload: reloadPlans } = useAsync(() => api.plans(), []);
  const { data: topupRequests, reload: reloadTopups } = useAsync(
    () => api.topupRequests(),
    [],
  );
  const [scope, setScope] = useState<Scope | null>(null);
  const [trackView, setTrackView] = useState<TrackView>("active");
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);
  const [reportPlanId, setReportPlanId] = useState<number | null>(null);
  const [showNewInvestor, setShowNewInvestor] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);

  const refreshAll = useCallback(() => {
    reload();
    reloadPlans();
    reloadTopups();
  }, [reload, reloadPlans, reloadTopups]);

  const effectiveScope: Scope = useMemo(() => {
    if (scope != null) return scope;
    if (!isManager && investors?.[0]) return investors[0].id;
    return "all";
  }, [scope, isManager, investors]);

  const selected = useMemo(() => {
    if (!investors?.length) return null;
    if (effectiveScope === "all") return null;
    return investors.find((i) => i.id === effectiveScope) ?? investors[0] ?? null;
  }, [investors, effectiveScope]);

  const selectedPlans = useMemo(() => {
    if (!selected) return [];
    return (plans ?? []).filter((p) => p.investor_id === selected.id);
  }, [plans, selected]);

  const activeSelectedPlans = useMemo(
    () => selectedPlans.filter((p) => p.status === "active"),
    [selectedPlans],
  );

  const closedSelectedPlans = useMemo(
    () => selectedPlans.filter((p) => p.status === "completed"),
    [selectedPlans],
  );

  const otherSelectedPlans = useMemo(
    () => selectedPlans.filter((p) => p.status !== "active" && p.status !== "completed"),
    [selectedPlans],
  );

  const portfolio = useMemo(() => {
    const list = investors ?? [];
    return {
      principal: list.reduce((s, i) => s + (i.active_principal || 0), 0),
      cash: list.reduce((s, i) => s + cashOf(i), 0),
      savings: list.reduce((s, i) => s + savingsOf(i), 0),
      savingsBalance: list.reduce((s, i) => s + (i.current_savings_balance || 0), 0),
      count: list.length,
      activePlans: list.reduce((s, i) => s + (i.active_plans_count || 0), 0),
    };
  }, [investors]);

  async function onCreateInvestor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const created = await api.createInvestor({
      name: String(fd.get("name") || "").trim(),
      phone: String(fd.get("phone") || "") || undefined,
      notes: String(fd.get("notes") || "") || undefined,
      username: String(fd.get("username") || "").trim() || undefined,
      password: String(fd.get("password") || "") || undefined,
      email: String(fd.get("email") || "").trim() || undefined,
      is_manager: String(fd.get("role") || "investor") === "manager",
    });
    setShowNewInvestor(false);
    setScope(created.id);
    setMessage("משקיע חדש נוסף עם שם משתמש וסיסמה");
    reload();
  }

  async function onCreatePlan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    const plan = await api.createPlan({
      investor_id: selected.id,
      principal: Number(fd.get("principal") || 0),
      plan_type: String(fd.get("plan_type") || "monthly"),
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
      savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
      manager_fee_percent: Number(fd.get("manager_fee_percent") || 0),
      start_date: String(fd.get("start_date") || yearStartISO()),
      duration_months: Number(fd.get("duration_months") || 12),
      notes: String(fd.get("notes") || "") || undefined,
      generate_schedule: true,
    });
    setShowNewPlan(false);
    setMessage(`מסלול ל-${plan.investor_name} נוצר עם לוח תשלומים`);
    refreshAll();
  }

  async function onUpdatePlan(
    e: FormEvent<HTMLFormElement>,
    plan: { id: number; start_date: string },
  ) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const nextStart = String(fd.get("start_date") || plan.start_date);
    const body: Parameters<typeof api.updatePlan>[1] = {
      principal: Number(fd.get("principal") || 0),
      plan_type: String(fd.get("plan_type") || "monthly"),
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
      savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
      manager_fee_percent: Number(fd.get("manager_fee_percent") || 0),
      duration_months: Number(fd.get("duration_months") || 12),
      status: String(fd.get("status") || "active"),
      regenerate_schedule: true,
    };
    if (nextStart !== plan.start_date) {
      body.start_date = nextStart;
    }
    await api.updatePlan(plan.id, body);
    setEditingPlanId(null);
    setMessage("המסלול עודכן — מזומן וחיסכון סונכרנו בנפרד");
    refreshAll();
  }

  async function onDeletePlan(plan: {
    id: number;
    start_date: string;
    investor_name: string;
    paid_count: number;
  }) {
    const year = plan.start_date.slice(0, 4);
    const paidNote =
      plan.paid_count > 0
        ? `\nשים לב: יש ${plan.paid_count} תשלומים שסומנו כשולמו — גם הם יימחקו.`
        : "";
    if (
      !window.confirm(
        `למחוק את מסלול #${plan.id} של ${plan.investor_name} (שנת ${year})?\nאחרי המחיקה המשקיע לא יופיע בדוח של ${year}.${paidNote}`,
      )
    ) {
      return;
    }
    try {
      await api.deletePlan(plan.id);
      setMessage(`מסלול #${plan.id} נמחק — ${plan.investor_name} לא יופיע בדוח ${year}`);
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת המסלול נכשלה");
    }
  }

  if (loading) return <div className="state">טוען משקיעים...</div>;
  if (error || !investors)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={reload}>
          נסה שוב
        </button>
      </div>
    );

  const planTarget = selected;

  return (
    <div className="page">
      <header className="page-intro">
        <div>
          <h1 className="page-intro__title">
            {isManager ? "משקיעים" : "המסלול שלי"}
          </h1>
        </div>
        {isManager ? (
          <div className="page-head__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setShowNewInvestor(true)}>
              משקיע חדש
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setShowNewPlan(true)}
              disabled={!planTarget}
            >
              מסלול חדש
            </button>
          </div>
        ) : null}
      </header>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}

      <TopupRequestsPanel
        isManager={isManager}
        investorId={effectiveScope === "all" ? null : selected?.id ?? null}
        settings={settings}
        requests={topupRequests ?? []}
        onChanged={refreshAll}
        onMessage={setMessage}
        onFocusInvestor={(id) => {
          setScope(id);
          setTrackView("active");
        }}
      />

      <div className="scope-bar" role="tablist" aria-label="בחירת משקיע">
        {isManager ? (
          <button
            type="button"
            role="tab"
            aria-selected={effectiveScope === "all"}
            className={effectiveScope === "all" ? "scope-bar__btn is-active" : "scope-bar__btn"}
            onClick={() => {
              setScope("all");
              setTrackView("active");
            }}
          >
            סה״כ כולם
          </button>
        ) : null}
        {investors.map((inv) => (
          <button
            key={inv.id}
            type="button"
            role="tab"
            aria-selected={effectiveScope === inv.id}
            className={effectiveScope === inv.id ? "scope-bar__btn is-active" : "scope-bar__btn"}
            onClick={() => {
              setScope(inv.id);
              setTrackView("active");
            }}
          >
            {inv.name}
            {inv.is_manager ? " · מנהל" : ""}
          </button>
        ))}
      </div>

      {effectiveScope === "all" && isManager ? (
        <div className="stack">
          <Panel
            title="סיכום כל המשקיעים"
            subtitle={`${portfolio.count} משקיעים · ${portfolio.activePlans} מסלולים פעילים · מזומן ≠ חיסכון`}
          >
            <div className="money-ledger">
              <div className="money-ledger__item money-ledger__item--accent">
                <span>סך קרן פעילה</span>
                <strong>{formatMoney(portfolio.principal)}</strong>
              </div>
              <div className="money-ledger__item">
                <span>החזר חודשי (מזומן)</span>
                <strong>{formatMoney(portfolio.cash)}</strong>
                <em>משולם כל חודש</em>
              </div>
              <div className="money-ledger__item">
                <span>צבירת חיסכון חודשית</span>
                <strong>{formatMoney(portfolio.savings)}</strong>
                <em>לא מזומן — נצבר בנפרד</em>
              </div>
              <div className="money-ledger__item">
                <span>יתרת חיסכון כעת</span>
                <strong>{formatMoney(portfolio.savingsBalance)}</strong>
              </div>
              <div className="money-ledger__item money-ledger__item--total">
                <span>סה״כ חודשי (מזומן + חיסכון)</span>
                <strong>{formatMoney(portfolio.cash + portfolio.savings)}</strong>
                <em>שתי שורות — לא כפילות</em>
              </div>
            </div>
          </Panel>

          <Panel title="פירוט לפי משקיע" subtitle="לחצו על שם כדי לפתוח את הכרטיס המלא">
            <div className="investor-table-wrap">
              <table className="investor-table">
                <thead>
                  <tr>
                    <th>משקיע</th>
                    <th>קרן</th>
                    <th>% מזומן</th>
                    <th>% חיסכון</th>
                    <th>החזר חודשי</th>
                    <th>חיסכון חודשי</th>
                    <th>יתרת חיסכון</th>
                    <th>סה״כ חודשי</th>
                  </tr>
                </thead>
                <tbody>
                  {investors.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setScope(inv.id)}
                        >
                          {inv.name}
                          {inv.is_manager ? " · מנהל" : ""}
                        </button>
                        <div className="muted tiny">
                          {(inv.plan_types ?? [])
                            .map((t) => planTypeLabel(t))
                            .join(" · ") || "אין מסלול פעיל"}
                        </div>
                      </td>
                      <td>{formatMoney(inv.active_principal)}</td>
                      <td>{formatPercent(inv.cash_rate_percent ?? 0)}</td>
                      <td>{formatPercent(inv.savings_rate_percent ?? 0)}</td>
                      <td>{formatMoney(cashOf(inv))}</td>
                      <td>{formatMoney(savingsOf(inv))}</td>
                      <td>{formatMoney(inv.current_savings_balance ?? 0)}</td>
                      <td>
                        <strong>{formatMoney(totalMonthlyOf(inv))}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : selected ? (
        <div className="stack">
          <Panel
            title={selected.name}
            subtitle={
              selected.is_manager
                ? "השקעה עצמית · עמלה נפרדת בדשבורד"
                : `${selected.months_in_program} חודשים בתוכנית · ${selected.active_plans_count ?? activeSelectedPlans.length} מסלולים פעילים`
            }
            action={<Link className="text-link" to="/payments">לתשלומים</Link>}
          >
            <div className="money-ledger">
              <div className="money-ledger__item money-ledger__item--accent">
                <span>קרן פעילה</span>
                <strong>{formatMoney(selected.active_principal)}</strong>
              </div>
              <div className="money-ledger__item">
                <span>% החזר מזומן</span>
                <strong>{formatPercent(selected.cash_rate_percent ?? 0)}</strong>
              </div>
              <div className="money-ledger__item">
                <span>% חיסכון</span>
                <strong>{formatPercent(selected.savings_rate_percent ?? 0)}</strong>
              </div>
              <div className="money-ledger__item">
                <span>החזר חודשי (מזומן)</span>
                <strong>{formatMoney(cashOf(selected))}</strong>
                <em>משולם כל חודש</em>
              </div>
              <div className="money-ledger__item">
                <span>צבירת חיסכון חודשית</span>
                <strong>{formatMoney(savingsOf(selected))}</strong>
                <em>נצבר בנפרד — לא מזומן</em>
              </div>
              <div className="money-ledger__item">
                <span>יתרת חיסכון כעת</span>
                <strong>{formatMoney(selected.current_savings_balance ?? 0)}</strong>
                <em>
                  צפי לסיום מסלול {formatMoney(selected.projected_savings_balance ?? 0)}
                </em>
              </div>
              <div className="money-ledger__item money-ledger__item--total">
                <span>סה״כ מגיע חודשי</span>
                <strong>{formatMoney(totalMonthlyOf(selected))}</strong>
                <em>
                  מזומן {formatMoney(cashOf(selected))} + חיסכון{" "}
                  {formatMoney(savingsOf(selected))}
                </em>
              </div>
            </div>
          </Panel>

          {selectedPlans.length === 0 ? (
            <Panel title="אין מסלול עדיין" subtitle="פתחו מסלול כדי להגדיר קרן ואחוזים">
              <p className="empty">עדיין אין מסלול למשקיע הזה.</p>
              {isManager ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setShowNewPlan(true)}
                >
                  פתח מסלול
                </button>
              ) : null}
            </Panel>
          ) : (
            <>
              <div className="track-view-switch" role="tablist" aria-label="הפרדת מסלולים">
                <button
                  type="button"
                  role="tab"
                  aria-selected={trackView === "active"}
                  className={
                    trackView === "active"
                      ? "track-view-switch__btn is-active"
                      : "track-view-switch__btn"
                  }
                  onClick={() => setTrackView("active")}
                >
                  מסלולים פעילים
                  <em>{activeSelectedPlans.length + otherSelectedPlans.length}</em>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={trackView === "closed"}
                  className={
                    trackView === "closed"
                      ? "track-view-switch__btn is-active"
                      : "track-view-switch__btn"
                  }
                  onClick={() => setTrackView("closed")}
                >
                  תיקים סגורים
                  <em>{closedSelectedPlans.length}</em>
                </button>
              </div>

              {trackView === "active" ? (
                activeSelectedPlans.length > 0 || otherSelectedPlans.length > 0 ? (
                  <div className="stack track-section track-section--active">
                    <p className="track-section__label">מסלולים פעילים בלבד</p>
                    {[...activeSelectedPlans, ...otherSelectedPlans].map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        isManager={isManager}
                        editing={editingPlanId === plan.id}
                        showReport={reportPlanId === plan.id}
                        onToggleEdit={() =>
                          setEditingPlanId((id) => (id === plan.id ? null : plan.id))
                        }
                        onToggleReport={() =>
                          setReportPlanId((id) => (id === plan.id ? null : plan.id))
                        }
                        onUpdate={onUpdatePlan}
                        onDelete={onDeletePlan}
                        onMessage={setMessage}
                        onSavingsChanged={() => {
                          refreshAll();
                          setTrackView("active");
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <Panel
                    title="אין מסלול פעיל"
                    subtitle="המסלולים הסגורים נמצאים בלשונית תיקים סגורים"
                  >
                    <p className="empty">אין מסלול פעיל למשקיע הזה כרגע.</p>
                    {closedSelectedPlans.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => setTrackView("closed")}
                      >
                        מעבר לתיקים סגורים ({closedSelectedPlans.length})
                      </button>
                    ) : null}
                    {isManager ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setShowNewPlan(true)}
                      >
                        פתח מסלול
                      </button>
                    ) : null}
                  </Panel>
                )
              ) : closedSelectedPlans.length > 0 ? (
                <Panel
                  title="תיקים סגורים"
                  subtitle="מופרדים מהפעילים · מסלולים שהסתיימו או נסגרו אחרי משיכה/העברה"
                >
                  <div className="closed-plans">
                    {closedSelectedPlans.map((plan) => (
                      <div key={plan.id} className="closed-plan-row">
                        <div>
                          <strong>
                            מסלול #{plan.id} · {planTypeLabel(plan.plan_type)} · סגור
                          </strong>
                          <span className="muted">
                            קרן {formatMoney(plan.principal)} ·{" "}
                            {plan.start_date} · {plan.duration_months} ח׳
                            {plan.successor_plan_id
                              ? ` · המשך במסלול #${plan.successor_plan_id}`
                              : " · נסגר ללא המשך"}
                          </span>
                          {plan.notes ? (
                            <span className="muted" style={{ display: "block" }}>
                              {plan.notes}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="btn btn--small btn--ghost"
                          onClick={() =>
                            setReportPlanId((id) => (id === plan.id ? null : plan.id))
                          }
                        >
                          {reportPlanId === plan.id ? "הסתר דוח" : "דוח מצב"}
                        </button>
                        {reportPlanId === plan.id ? (
                          <div style={{ flexBasis: "100%" }}>
                            <PlanStatusReportPanel
                              planId={plan.id}
                              title={`דוח מצב · מסלול סגור #${plan.id}`}
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Panel>
              ) : (
                <Panel title="אין תיקים סגורים" subtitle="עדיין לא נסגר אף מסלול למשקיע הזה">
                  <p className="empty">אין תיקים סגורים.</p>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setTrackView("active")}
                  >
                    חזרה למסלולים פעילים
                  </button>
                </Panel>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="empty">בחרו משקיע מהרשימה למעלה.</p>
      )}

      {showNewInvestor ? (
        <Modal title="משקיע חדש" onClose={() => setShowNewInvestor(false)}>
          <form className="form" onSubmit={onCreateInvestor}>
            <label>
              שם
              <input name="name" required placeholder="שם המשקיע" />
            </label>
            <label>
              שם משתמש לגישה
              <input name="username" required placeholder="revital" autoComplete="off" />
            </label>
            <PasswordField
              label="סיסמה התחלתית"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <label>
              הרשאה
              <select name="role" defaultValue="investor">
                <option value="investor">משקיע — רואה רק את שלו</option>
                <option value="manager">מנהל — גישה מלאה</option>
              </select>
            </label>
            <label>
              טלפון
              <input name="phone" placeholder="אופציונלי" />
            </label>
            <label>
              מייל (אופציונלי)
              <input name="email" type="email" placeholder="אופציונלי" />
            </label>
            <label>
              הערות
              <textarea name="notes" rows={3} />
            </label>
            <button type="submit" className="btn btn--primary">
              הוסף
            </button>
          </form>
        </Modal>
      ) : null}

      {showNewPlan && planTarget ? (
        <Modal title={`מסלול חדש ל-${planTarget.name}`} onClose={() => setShowNewPlan(false)}>
          <PlanForm settings={settings} onSubmit={onCreatePlan} />
        </Modal>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  isManager,
  editing,
  showReport,
  onToggleEdit,
  onToggleReport,
  onUpdate,
  onDelete,
  onSavingsChanged,
  onMessage,
}: {
  plan: Plan;
  isManager: boolean;
  editing: boolean;
  showReport: boolean;
  onToggleEdit: () => void;
  onToggleReport: () => void;
  onUpdate: (
    e: FormEvent<HTMLFormElement>,
    plan: { id: number; start_date: string },
  ) => Promise<void>;
  onDelete: (plan: {
    id: number;
    start_date: string;
    investor_name: string;
    paid_count: number;
  }) => Promise<void>;
  onSavingsChanged: () => void;
  onMessage: (text: string) => void;
}) {
  const statusLabelHe =
    plan.status === "active" ? "פעיל" : plan.status === "paused" ? "מושהה" : "הסתיים";

  return (
    <Panel
      title={`${planTypeLabel(plan.plan_type)} · מסלול #${plan.id}`}
      subtitle={`${statusLabelHe} · ${plan.duration_months} חודשים · ${plan.months_elapsed}/${plan.duration_months}`}
      action={
        <div className="page-head__actions">
          <button type="button" className="btn btn--small btn--ghost" onClick={onToggleReport}>
            {showReport ? "הסתר דוח" : "דוח מצב"}
          </button>
          {isManager ? (
            <button type="button" className="btn btn--small btn--ghost" onClick={onToggleEdit}>
              {editing ? "סגור עריכה" : "ערוך"}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="money-ledger money-ledger--compact">
        <div className="money-ledger__item">
          <span>קרן</span>
          <strong>{formatMoney(plan.principal)}</strong>
        </div>
        {plan.plan_type !== "savings" ? (
          <div className="money-ledger__item">
            <span>מזומן {formatPercent(plan.monthly_rate_percent)}</span>
            <strong>{formatMoney(plan.monthly_investor_payout, true)}</strong>
            <em>/ חודש</em>
          </div>
        ) : null}
        {plan.plan_type !== "monthly" ? (
          <div className="money-ledger__item">
            <span>חיסכון {formatPercent(plan.savings_rate_percent)}</span>
            <strong>{formatMoney(plan.monthly_savings_accrual, true)}</strong>
            <em>/ חודש · נצבר</em>
          </div>
        ) : null}
        {plan.plan_type !== "monthly" ? (
          <div className="money-ledger__item">
            <span>יתרת חיסכון</span>
            <strong>{formatMoney(plan.current_savings_balance ?? 0)}</strong>
            <em>צפי {formatMoney(plan.projected_savings_balance)}</em>
          </div>
        ) : null}
        {isManager ? (
          <div className="money-ledger__item">
            <span>עמלת ניהול {formatPercent(plan.manager_fee_percent ?? 0)}</span>
            <strong>{formatMoney(plan.monthly_manager_fee ?? 0, true)}</strong>
            <em>נוספת — לא מהמשקיע</em>
          </div>
        ) : null}
        <div className="money-ledger__item">
          <span>שולם בפועל (מזומן)</span>
          <strong>{formatMoney(plan.paid_investor_total)}</strong>
          <em>{plan.paid_count} תשלומים</em>
        </div>
      </div>

      {plan.can_cancel_investment && plan.source_request_id ? (
        <PlanCoolingOffBanner
          planId={plan.id}
          requestId={plan.source_request_id}
          until={plan.cooling_off_until}
          daysLeft={plan.cooling_off_days_left}
          canCancel={Boolean(plan.can_cancel_investment)}
          onChanged={onSavingsChanged}
          onMessage={onMessage}
        />
      ) : null}

      <SavingsActions
        plan={plan}
        canManage={isManager}
        onDone={onSavingsChanged}
      />

      {showReport ? (
        <PlanStatusReportPanel
          planId={plan.id}
          title={`דוח מצב · ${planTypeLabel(plan.plan_type)}`}
        />
      ) : null}

      {isManager && editing ? (
        <form className="form" onSubmit={(e) => onUpdate(e, plan)}>
          <div className="form__grid">
            <label>
              קרן (₪)
              <input name="principal" type="number" min="0" step="0.01" defaultValue={plan.principal} />
            </label>
            <PlanTrackFields
              defaultPlanType={plan.plan_type}
              defaultMonthlyRate={plan.monthly_rate_percent}
              defaultSavingsRate={plan.savings_rate_percent}
              defaultPrincipal={plan.principal}
            />
            <label>
              אחוז עמלת ניהול
              <input
                name="manager_fee_percent"
                type="number"
                min="0"
                step="0.01"
                defaultValue={plan.manager_fee_percent ?? 0}
              />
            </label>
            <label>
              תאריך התחלה
              <input name="start_date" type="date" defaultValue={plan.start_date} />
            </label>
            <label>
              משך (חודשים)
              <input
                name="duration_months"
                type="number"
                min="1"
                max="120"
                defaultValue={plan.duration_months}
              />
            </label>
            <label>
              סטטוס
              <select name="status" defaultValue={plan.status}>
                <option value="active">פעיל</option>
                <option value="paused">מושהה</option>
                <option value="completed">הסתיים</option>
              </select>
            </label>
          </div>
          <div className="page-head__actions">
            <button type="submit" className="btn btn--primary">
              שמור שינויים
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--danger"
              onClick={() => onDelete(plan)}
            >
              מחק מסלול
            </button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

function PlanForm({
  settings,
  onSubmit,
}: {
  settings: Settings | null;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form__grid">
        <label>
          קרן (₪)
          <input name="principal" type="number" min="0" step="0.01" defaultValue={0} required />
        </label>
        <PlanTrackFields
          defaultPlanType="monthly"
          defaultMonthlyRate={settings?.default_monthly_rate_percent ?? 0}
          defaultSavingsRate={0}
          defaultPrincipal={0}
        />
        <label>
          אחוז עמלת ניהול (נוסף)
          <input
            name="manager_fee_percent"
            type="number"
            min="0"
            step="0.01"
            defaultValue={settings?.default_manager_fee_percent ?? 0}
            required
          />
        </label>
        <label>
          תאריך התחלה
          <input name="start_date" type="date" defaultValue={yearStartISO()} required />
        </label>
        <label>
          משך (חודשים)
          <select name="duration_months" defaultValue={settings?.default_duration_months ?? 12}>
            {[12, 14, 18, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} חודשים
              </option>
            ))}
            <option value="6">6 חודשים</option>
            <option value="10">10 חודשים</option>
            <option value="15">15 חודשים</option>
            <option value="16">16 חודשים</option>
          </select>
        </label>
        <label>
          הערות
          <input name="notes" placeholder="אופציונלי" />
        </label>
      </div>
      <p className="hint">
        מזומן וחיסכון נשמרים כשדות נפרדים. עמלת ניהול מתווספת מעבר לתשלום למשקיע.
      </p>
      <button type="submit" className="btn btn--primary">
        צור מסלול + לוח תשלומים
      </button>
    </form>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <button type="button" className="modal__backdrop" aria-label="סגירה" onClick={onClose} />
      <div className="modal__sheet">
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            סגור
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
