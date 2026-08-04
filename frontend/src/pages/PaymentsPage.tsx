import { useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { formatDate, formatMoney, statusLabel } from "../utils/format";

export function PaymentsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const yearNow = new Date().getFullYear();
  const [year, setYear] = useState(yearNow);
  const [status, setStatus] = useState<string>("");
  const [investorId, setInvestorId] = useState<string>("");

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );
  const { data, error, loading, reload } = useAsync(
    () =>
      api.payments({
        year,
        status: status || undefined,
        investor_id: investorId ? Number(investorId) : undefined,
      }),
    [year, status, investorId],
  );

  const totals = useMemo(() => {
    const list = data ?? [];
    const paid = list.filter((p) => p.status === "paid");
    return {
      investor: paid.reduce((s, p) => s + p.investor_amount, 0),
      manager: paid.reduce((s, p) => s + p.manager_amount, 0),
      scheduled: list.filter((p) => p.status === "scheduled").length,
      paidCount: paid.length,
    };
  }, [data]);

  async function markPaid(id: number) {
    await api.updatePayment(id, { status: "paid" });
    reload();
  }

  async function markScheduled(id: number) {
    await api.updatePayment(id, { status: "scheduled" });
    reload();
  }

  if (loading) return <div className="state">טוען היסטוריית תשלומים...</div>;
  if (error)
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
          <h1>{isManager ? "תשלומים והיסטוריה" : "התשלומים שלי"}</h1>
          <p className="muted">
            {isManager ? "מי קיבל כל חודש, כמה, ומתי" : "רק התשלומים שלך"}
          </p>
        </div>
      </div>

      <div className="filters">
        <label>
          שנה
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[yearNow, yearNow - 1, yearNow - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          סטטוס
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">הכל</option>
            <option value="scheduled">מתוכנן</option>
            <option value="paid">שולם</option>
            <option value="skipped">דולג</option>
          </select>
        </label>
        {isManager ? (
          <label>
            משקיע
            <select value={investorId} onChange={(e) => setInvestorId(e.target.value)}>
              <option value="">הכל</option>
              {(investors ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="stats-grid stats-grid--compact">
        <div className="stat">
          <span className="stat__label">{isManager ? "שולם למשקיעים" : "שולם לי"}</span>
          <strong className="stat__value">{formatMoney(totals.investor)}</strong>
        </div>
        {isManager ? (
          <div className="stat tone-manager">
            <span className="stat__label">עמלות שהתקבלו</span>
            <strong className="stat__value">{formatMoney(totals.manager)}</strong>
          </div>
        ) : null}
        <div className="stat">
          <span className="stat__label">תשלומים ששולמו</span>
          <strong className="stat__value">{totals.paidCount}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">ממתינים</span>
          <strong className="stat__value">{totals.scheduled}</strong>
        </div>
      </div>

      <Panel
        title={`רשימת ${year}`}
        subtitle={isManager ? "סמני כששולם בפועל" : "תצוגה בלבד"}
      >
        {(data ?? []).length === 0 ? (
          <p className="empty">אין רשומות לשנה זו. צרי מסלול כדי לייצר לוח תשלומים.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {isManager ? <th>משקיע</th> : null}
                  <th>חודש</th>
                  <th>תאריך</th>
                  <th>סכום</th>
                  {isManager ? <th>עמלה</th> : null}
                  <th>סטטוס</th>
                  {isManager ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((p) => (
                  <tr key={p.id}>
                    {isManager ? <td>{p.investor_name}</td> : null}
                    <td>{p.month_number}</td>
                    <td>{formatDate(p.due_date)}</td>
                    <td>{formatMoney(p.investor_amount, true)}</td>
                    {isManager ? <td>{formatMoney(p.manager_amount, true)}</td> : null}
                    <td>
                      <span className={`badge badge--${p.status}`}>{statusLabel(p.status)}</span>
                    </td>
                    {isManager ? (
                      <td className="table__actions">
                        {p.status !== "paid" ? (
                          <button type="button" className="btn btn--small" onClick={() => markPaid(p.id)}>
                            סמני שולם
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => markScheduled(p.id)}
                          >
                            בטלי
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
