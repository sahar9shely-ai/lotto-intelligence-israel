import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { PlanTrackFields } from "../components/PlanTrackFields";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Settings } from "../types/investments";
import { formatMoney, formatPercent, yearStartISO } from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";

export function InvestorsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const { data: investors, error, loading, reload } = useAsync(() => api.investors(), []);
  const { data: settings } = useAsync(
    () => (isManager ? api.settings() : Promise.resolve(null)),
    [isManager],
  );
  const { data: plans, reload: reloadPlans } = useAsync(() => api.plans(), []);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNewInvestor, setShowNewInvestor] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => investors?.find((i) => i.id === selectedId) ?? investors?.[0] ?? null,
    [investors, selectedId],
  );

  const selectedPlans = useMemo(
    () => (plans ?? []).filter((p) => p.investor_id === selected?.id),
    [plans, selected],
  );

  async function onCreateInvestor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.createInvestor({
      name: String(fd.get("name") || "").trim(),
      phone: String(fd.get("phone") || "") || undefined,
      notes: String(fd.get("notes") || "") || undefined,
      username: String(fd.get("username") || "").trim() || undefined,
      password: String(fd.get("password") || "") || undefined,
      email: String(fd.get("email") || "").trim() || undefined,
      is_manager: String(fd.get("role") || "investor") === "manager",
    });
    setShowNewInvestor(false);
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
    reload();
    reloadPlans();
  }

  async function onUpdatePlan(e: FormEvent<HTMLFormElement>, planId: number) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.updatePlan(planId, {
      principal: Number(fd.get("principal") || 0),
      plan_type: String(fd.get("plan_type") || "monthly"),
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
      savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
      manager_fee_percent: Number(fd.get("manager_fee_percent") || 0),
      start_date: String(fd.get("start_date")),
      duration_months: Number(fd.get("duration_months") || 12),
      status: String(fd.get("status") || "active"),
      regenerate_schedule: true,
    });
    setMessage("המסלול עודכן ולוח התשלומים חודש");
    reload();
    reloadPlans();
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
      reload();
      reloadPlans();
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isManager ? "משקיעים ומסלולים" : "המסלול שלי"}</h1>
          <p className="muted">
            {isManager
              ? "החזר חודשי · חיסכון · משולב · משך גמיש"
              : "צפייה בנתונים שלך בלבד"}
          </p>
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
              disabled={!selected}
            >
              מסלול חדש
            </button>
          </div>
        ) : null}
      </div>

      {message ? <p className="toast">{message}</p> : null}

      <div className="grid-investors">
        <Panel title="רשימה">
          <ul className="picker">
            {investors.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  className={
                    selected?.id === inv.id ? "picker__item is-active" : "picker__item"
                  }
                  onClick={() => setSelectedId(inv.id)}
                >
                  <span>
                    {inv.name}
                    {inv.is_manager ? " · מנהל" : ""}
                  </span>
                  <span className="muted">{formatMoney(inv.active_principal)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="stack">
          {selected ? (
            <>
              <Panel
                title={selected.name}
                subtitle={
                  selected.is_manager
                    ? "השקעה עצמית + עמלת ניהול נפרדת"
                    : `${selected.months_in_program} חודשים בתוכנית`
                }
                action={<Link className="text-link" to="/payments">תשלומים</Link>}
              >
                <div className="kv">
                  <div>
                    <span>קרן פעילה</span>
                    <strong>{formatMoney(selected.active_principal)}</strong>
                  </div>
                  <div>
                    <span>תשלום חודשי</span>
                    <strong>{formatMoney(selected.monthly_payout)}</strong>
                  </div>
                  <div>
                    <span>מסלולים</span>
                    <strong>{selected.plans_count}</strong>
                  </div>
                </div>
              </Panel>

              {selectedPlans.length === 0 ? (
                <Panel title="אין מסלול עדיין" subtitle="כשתמלא את הסכומים — פתח מסלול כאן">
                  <p className="empty">המספרים יוגדרו בהמשך. בינתיים אפשר לפתוח מסלול עם ערכים זמניים.</p>
                </Panel>
              ) : (
                selectedPlans.map((plan) => (
                  <Panel
                    key={plan.id}
                    title={`מסלול #${plan.id}`}
                    subtitle={
                      isManager
                        ? `${planTypeLabel(plan.plan_type)} · ${plan.duration_months} חודשים · עמלה ${formatPercent(plan.manager_fee_percent)}`
                        : `${planTypeLabel(plan.plan_type)} · ${plan.duration_months} חודשים`
                    }
                    action={
                      isManager ? (
                        <button
                          type="button"
                          className="btn btn--small btn--ghost btn--danger"
                          onClick={() => onDeletePlan(plan)}
                        >
                          מחק מסלול
                        </button>
                      ) : null
                    }
                  >
                    <div className="kv kv--dense">
                      {plan.plan_type !== "savings" ? (
                        <div>
                          <span>חודשי למשקיע (מזומן)</span>
                          <strong>{formatMoney(plan.monthly_investor_payout, true)}</strong>
                        </div>
                      ) : null}
                      {plan.plan_type !== "monthly" ? (
                        <div>
                          <span>צבירת חיסכון חודשית</span>
                          <strong>{formatMoney(plan.monthly_savings_accrual, true)}</strong>
                        </div>
                      ) : null}
                      {plan.plan_type !== "monthly" ? (
                        <div>
                          <span>יתרת חיסכון צפויה</span>
                          <strong>{formatMoney(plan.projected_savings_balance)}</strong>
                        </div>
                      ) : null}
                      {isManager ? (
                        <div>
                          <span>עמלה חודשית</span>
                          <strong>{formatMoney(plan.monthly_manager_fee, true)}</strong>
                        </div>
                      ) : null}
                      <div>
                        <span>סה״כ למסלול</span>
                        <strong>{formatMoney(plan.total_investor_payout)}</strong>
                      </div>
                      <div>
                        <span>שנתי (×12 / שנה א׳)</span>
                        <strong>{formatMoney(plan.annual_investor_payout)}</strong>
                      </div>
                      <div>
                        <span>התקדמות</span>
                        <strong>
                          {plan.months_elapsed}/{plan.duration_months} · נותרו{" "}
                          {plan.months_remaining}
                        </strong>
                      </div>
                      <div>
                        <span>שולם בפועל</span>
                        <strong>
                          {formatMoney(plan.paid_investor_total)} ({plan.paid_count} תשלומים)
                        </strong>
                      </div>
                    </div>

                    {isManager ? (
                      <form className="form" onSubmit={(e) => onUpdatePlan(e, plan.id)}>
                      <div className="form__grid">
                        <label>
                          קרן (₪)
                          <input name="principal" type="number" min="0" step="0.01" defaultValue={plan.principal} />
                        </label>
                        <PlanTrackFields
                          defaultPlanType={plan.plan_type}
                          defaultMonthlyRate={plan.monthly_rate_percent}
                          defaultSavingsRate={plan.savings_rate_percent}
                        />
                        <label>
                          אחוז עמלת ניהול
                          <input
                            name="manager_fee_percent"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={plan.manager_fee_percent}
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
                          onClick={() => onDeletePlan(plan)}
                        >
                          מחק מסלול
                        </button>
                      </div>
                    </form>
                    ) : null}
                  </Panel>
                ))
              )}
            </>
          ) : null}
        </div>
      </div>

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

      {showNewPlan && selected ? (
        <Modal title={`מסלול חדש ל-${selected.name}`} onClose={() => setShowNewPlan(false)}>
          <PlanForm settings={settings} onSubmit={onCreatePlan} />
        </Modal>
      ) : null}
    </div>
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
        ברירת המחדל היא 1 בינואר של השנה הנוכחית — כדי שהלוח יהיה שנתי מתחילת השנה ועד סופה.
        עמלת הניהול מתווספת מעבר לתשלום למשקיע — לא נגזרת מהאחוזים שלו.
        במסלול חיסכון/משולב הריבית על החיסכון מתרכבת כל 12 חודשים.
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
            סגרי
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
