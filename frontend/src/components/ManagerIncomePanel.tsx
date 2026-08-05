import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { ManagerIncomeBoard } from "../types/investments";
import { formatMoney, formatPercent, formatCalendarMonth } from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";
import { Panel } from "./Panel";

export function ManagerIncomePanel() {
  const { data, error, loading, reload } = useAsync(
    () => api.managerIncome(),
    [],
  );

  if (loading) {
    return (
      <Panel title="הכנסות מנהל" subtitle="טוען...">
        <p className="muted">טוען נתוני עמלות והחזר...</p>
      </Panel>
    );
  }

  if (error || !data) {
    return (
      <Panel title="הכנסות מנהל" subtitle="למנהל בלבד">
        <p className="form-error">{error || "לא ניתן לטעון"}</p>
        <button type="button" className="btn btn--small" onClick={reload}>
          נסה שוב
        </button>
      </Panel>
    );
  }

  return <ManagerIncomeBoardView data={data} />;
}

export function ManagerIncomeBoardView({ data }: { data: ManagerIncomeBoard }) {
  const own = data.manager_own;
  const name = data.manager_name || own.investor_name || "סהר";

  return (
    <Panel
      title="הכנסות מנהל · כל חודש"
      subtitle="למנהל בלבד · כמה כל משקיע מביא בעמלה + ההחזר של סהר לפי ההשקעה שלה"
    >
      <div className="manager-income">
        <div className="manager-income__hero">
          <div className="manager-income__hero-main">
            <span className="stat__label">סה״כ כל חודש אליי</span>
            <strong className="manager-income__hero-value">
              {formatMoney(data.monthly_grand_total)}
            </strong>
            <span className="muted">
              עמלות {formatMoney(data.monthly_fees_total)} + החזר {name}{" "}
              {formatMoney(own.monthly_total)}
            </span>
          </div>
          <div className="manager-income__hero-split">
            <div>
              <span className="stat__label">עמלות ממשקיעים</span>
              <strong>{formatMoney(data.monthly_fees_total)}</strong>
            </div>
            <div>
              <span className="stat__label">החזר {name}</span>
              <strong>{formatMoney(own.monthly_total)}</strong>
            </div>
          </div>
        </div>

        <section className="manager-income__section">
          <h3 className="manager-income__section-title">
            כמה כל משקיע מביא לי (עמלת ניהול)
          </h3>
          {data.investors.length === 0 ? (
            <p className="muted">אין משקיעים פעילים עם עמלה כרגע.</p>
          ) : (
            <ul className="manager-income__list">
              {data.investors.map((row) => (
                <li key={row.investor_id} className="manager-income__row">
                  <div className="manager-income__row-main">
                    <strong>{row.investor_name}</strong>
                    <span className="muted">
                      קרן {formatMoney(row.principal)}
                      {row.plans.length === 1
                        ? ` · עמלה ${formatPercent(row.plans[0].manager_fee_percent)}`
                        : ` · ${row.plans.length} מסלולים`}
                    </span>
                  </div>
                  <div className="manager-income__row-fee">
                    <span className="stat__label">מביא לי בחודש</span>
                    <strong>
                      {row.monthly_fee > 0
                        ? formatMoney(row.monthly_fee)
                        : "ללא עמלה"}
                    </strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="manager-income__subtotal">
            <span>סה״כ עמלות בחודש</span>
            <strong>{formatMoney(data.monthly_fees_total)}</strong>
          </div>
        </section>

        <section className="manager-income__section manager-income__section--own">
          <h3 className="manager-income__section-title">
            החזר {name} · לפי ההשקעה שלה
          </h3>
          {own.plans.length === 0 ? (
            <p className="muted">אין מסלול פעיל ל{name}.</p>
          ) : (
            <>
              <div className="manager-income__own-summary">
                <div>
                  <span className="stat__label">קרן</span>
                  <strong>{formatMoney(own.principal)}</strong>
                </div>
                <div>
                  <span className="stat__label">מזומן בחודש</span>
                  <strong>{formatMoney(own.monthly_cash)}</strong>
                </div>
                <div>
                  <span className="stat__label">חיסכון בחודש</span>
                  <strong>{formatMoney(own.monthly_savings)}</strong>
                </div>
                <div className="manager-income__own-total">
                  <span className="stat__label">סה״כ החזר חודשי</span>
                  <strong>{formatMoney(own.monthly_total)}</strong>
                  <span className="muted">מזומן + חיסכון</span>
                </div>
              </div>
              {own.plans.map((p) => (
                <div key={p.plan_id} className="manager-income__own-plan">
                  <strong>
                    מסלול #{p.plan_id} · {planTypeLabel(p.plan_type)}
                  </strong>
                  <span className="muted">
                    {formatCalendarMonth(p.start_date)} →{" "}
                    {formatCalendarMonth(p.track_end_date)} ·{" "}
                    {p.months_elapsed}/{p.duration_months} ח׳ · קרן{" "}
                    {formatMoney(p.principal)}
                    {p.monthly_rate_percent > 0
                      ? ` · מזומן ${formatPercent(p.monthly_rate_percent)}`
                      : ""}
                    {p.savings_rate_percent > 0
                      ? ` · חיסכון ${formatPercent(p.savings_rate_percent)}`
                      : ""}
                  </span>
                  <span>
                    החזר חודשי במסלול זה:{" "}
                    <strong>{formatMoney(p.monthly_total)}</strong>
                    {" ("}
                    מזומן {formatMoney(p.monthly_cash)}
                    {p.monthly_savings > 0
                      ? ` + חיסכון ${formatMoney(p.monthly_savings)}`
                      : ""}
                    {")"}
                  </span>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </Panel>
  );
}
