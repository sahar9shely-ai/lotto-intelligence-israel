import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Settings } from "../types/investments";
import { formatMoney, formatPercent, yearStartISO } from "../utils/format";

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
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
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
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
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

  if (loading) return <div className="state">טוען משקיעים...</div>;
  if (error || !investors)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={reload}>
          נסי שוב
        </button>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isManager ? "משקיעים ומסלולים" : "המסלול שלי"}</h1>
          <p className="muted">
            {isManager ? "אחוזים קבועים לפי חוזה · משך מסלול גמיש" : "צפייה בנתונים שלך בלבד"}
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
        <Panel title="רשימה" subtitle="בר · אופק · אלמוג · שושי + מנהלת">
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
                    {inv.is_manager ? " · מנהלת" : ""}
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
                <Panel title="אין מסלול עדיין" subtitle="כשתמלאי את הסכומים — פתחי מסלול כאן">
                  <p className="empty">המספרים יוגדרו בהמשך. בינתיים אפשר לפתוח מסלול עם ערכים זמניים.</p>
                </Panel>
              ) : (
                selectedPlans.map((plan) => (
                  <Panel
                    key={plan.id}
                    title={`מסלול #${plan.id}`}
                    subtitle={
                      isManager
                        ? `${plan.duration_months} חודשים · ${formatPercent(plan.monthly_rate_percent)} חודשי · עמלה ${formatPercent(plan.manager_fee_percent)}`
                        : `${plan.duration_months} חודשים · ${formatPercent(plan.monthly_rate_percent)} חודשי`
                    }
                  >
                    <div className="kv kv--dense">
                      <div>
                        <span>חודשי למשקיע</span>
                        <strong>{formatMoney(plan.monthly_investor_payout, true)}</strong>
                      </div>
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
                        <span>שנתי (×12)</span>
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
                        <label>
                          אחוז חודשי למשקיע
                          <input
                            name="monthly_rate_percent"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={plan.monthly_rate_percent}
                          />
                        </label>
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
                      <button type="submit" className="btn btn--primary">
                        שמרי שינויים
                      </button>
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
              הוסיפי
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
        <label>
          אחוז חודשי למשקיע
          <input
            name="monthly_rate_percent"
            type="number"
            min="0"
            step="0.01"
            defaultValue={settings?.default_monthly_rate_percent ?? 0}
            required
          />
        </label>
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
      </p>
      <button type="submit" className="btn btn--primary">
        צרי מסלול + לוח תשלומים
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
