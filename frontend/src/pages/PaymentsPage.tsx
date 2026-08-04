import { useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import {
  formatCalendarMonth,
  formatDate,
  formatMoney,
  statusLabel,
} from "../utils/format";
import { downloadYearlyPaymentsPdf } from "../utils/paymentsPdf";

export function PaymentsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const yearNow = new Date().getFullYear();
  const [year, setYear] = useState(yearNow);
  const [status, setStatus] = useState<string>("");
  const [investorId, setInvestorId] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [alignBusy, setAlignBusy] = useState(false);

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

  const payments = useMemo(() => data ?? [], [data]);

  const totals = useMemo(() => {
    const paid = payments.filter((p) => p.status === "paid");
    return {
      investor: paid.reduce((s, p) => s + p.investor_amount, 0),
      manager: paid.reduce((s, p) => s + p.manager_amount, 0),
      scheduled: payments.filter((p) => p.status === "scheduled").length,
      paidCount: paid.length,
    };
  }, [payments]);

  const selectedInvestorName = useMemo(() => {
    if (!investorId) return null;
    return (investors ?? []).find((i) => String(i.id) === investorId)?.name ?? null;
  }, [investorId, investors]);

  async function markPaid(id: number) {
    await api.updatePayment(id, { status: "paid" });
    reload();
  }

  async function markScheduled(id: number) {
    await api.updatePayment(id, { status: "scheduled" });
    reload();
  }

  async function exportYearPdf() {
    setPdfBusy(true);
    setMessage(null);
    try {
      await downloadYearlyPaymentsPdf({
        year,
        payments,
        isManager,
        investorFilterName: selectedInvestorName,
      });
      setMessage(`דוח שנתי ${year} ירד בהצלחה`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ייצוא PDF נכשל");
    } finally {
      setPdfBusy(false);
    }
  }

  async function alignToCalendarYear() {
    if (
      !window.confirm(
        `ליישר את לוחות התשלומים לשנה הקלנדרית ${year}?\nהמסלולים יתחילו ב-1 בינואר ${year} ויכסו את השנה מתחילתה ועד סופה.`,
      )
    ) {
      return;
    }
    setAlignBusy(true);
    setMessage(null);
    try {
      const result = await api.alignCalendarYear(year);
      setMessage(
        result.count
          ? `יושרו ${result.count} מסלולים לשנת ${year} (1 בינואר – 31 בדצמבר)`
          : `כל המסלולים כבר מיושרים לשנה הקלנדרית ${year}`,
      );
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "יישור שנתי נכשל");
    } finally {
      setAlignBusy(false);
    }
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
            דוח שנתי קלנדרי · 1 בינואר עד 31 בדצמבר {year}
          </p>
        </div>
        <div className="page-head__actions">
          {isManager ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={alignBusy}
              onClick={alignToCalendarYear}
            >
              {alignBusy ? "מיישרים..." : "יישור לתחילת שנה"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            disabled={pdfBusy}
            onClick={exportYearPdf}
          >
            {pdfBusy ? "מכינים PDF..." : `הורדת דוח ${year}`}
          </button>
        </div>
      </div>

      {message ? <p className="toast">{message}</p> : null}

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
        title={`שנת ${year}`}
        subtitle="מתחילת השנה ועד סופה · לפי חודש קלנדרי"
      >
        {payments.length === 0 ? (
          <p className="empty">
            אין רשומות לשנה זו. צרי מסלול מתאריך 1 בינואר כדי לייצר לוח שנתי מלא.
          </p>
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
                {payments.map((p) => (
                  <tr key={p.id}>
                    {isManager ? <td>{p.investor_name}</td> : null}
                    <td>{formatCalendarMonth(p.due_date)}</td>
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
