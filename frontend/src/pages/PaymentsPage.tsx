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
  const [openBusy, setOpenBusy] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);

  const investorFilter = investorId ? Number(investorId) : undefined;

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );
  const { data, error, loading, reload } = useAsync(
    () =>
      api.payments({
        year,
        status: status || undefined,
        investor_id: investorFilter,
      }),
    [year, status, investorFilter],
  );
  const {
    data: report,
    reload: reloadReport,
  } = useAsync(
    () => api.paymentReport(year, investorFilter),
    [year, investorFilter],
  );
  const {
    data: yearAll,
    reload: reloadYearAll,
  } = useAsync(
    () => (isManager ? api.payments({ year }) : Promise.resolve([])),
    [year, isManager],
  );

  const payments = useMemo(() => data ?? [], [data]);
  const yearly = report?.yearly;
  const lifetime = report?.lifetime;

  const yearInvestors = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of yearAll ?? []) {
      map.set(p.investor_id, p.investor_name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [yearAll]);

  const yearOptions = useMemo(() => {
    const fromApi = report?.available_years ?? [];
    const set = new Set<number>([...fromApi, yearNow, yearNow - 1, yearNow - 2, 2025]);
    return [...set].sort((a, b) => b - a);
  }, [report?.available_years, yearNow]);

  const selectedInvestorName = useMemo(() => {
    if (!investorId) return null;
    return (investors ?? []).find((i) => String(i.id) === investorId)?.name ?? null;
  }, [investorId, investors]);

  function refreshAll() {
    reload();
    reloadReport();
    reloadYearAll();
  }

  async function markPaid(id: number) {
    await api.updatePayment(id, { status: "paid" });
    refreshAll();
  }

  async function markScheduled(id: number) {
    await api.updatePayment(id, { status: "scheduled" });
    refreshAll();
  }

  async function exportYearPdf() {
    setPdfBusy(true);
    setMessage(null);
    try {
      // Export the full year (ignore status filter) so the annual report is complete.
      const yearPayments = await api.payments({
        year,
        investor_id: investorFilter,
      });
      await downloadYearlyPaymentsPdf({
        year,
        payments: yearPayments,
        isManager,
        investorFilterName: selectedInvestorName,
        lifetime,
      });
      setMessage(`דוח שנתי ${year} ירד בהצלחה`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ייצוא PDF נכשל");
    } finally {
      setPdfBusy(false);
    }
  }

  async function openReportingYear() {
    if (
      !window.confirm(
        `לפתוח לוח תשלומים מלא לשנת ${year}?\nיווצר מסלול 1 בינואר–31 בדצמבר לפי תנאי המסלול הנוכחי של כל משקיע.`,
      )
    ) {
      return;
    }
    setOpenBusy(true);
    setMessage(null);
    try {
      const result = await api.openCalendarYear(year);
      setMessage(
        result.created_count
          ? `נפתח לוח לשנת ${year} עבור ${result.created_count} משקיעים — אפשר למלא את הדוח`
          : `כבר קיים לוח לשנת ${year}`,
      );
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "פתיחת שנת דיווח נכשלה");
    } finally {
      setOpenBusy(false);
    }
  }

  async function markEntireYearPaid() {
    if (
      !window.confirm(
        `לסמן את כל התשלומים המתוכננים בשנת ${year} כשולמו?\nמתאים למילוי דוח שנתי היסטורי.`,
      )
    ) {
      return;
    }
    setMarkBusy(true);
    setMessage(null);
    try {
      const result = await api.markYearPaid(year, investorFilter);
      setMessage(
        result.marked_count
          ? `סומנו ${result.marked_count} תשלומים כשולמו לשנת ${year}`
          : `אין תשלומים ממתינים לשנת ${year}`,
      );
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סימון שנתי נכשל");
    } finally {
      setMarkBusy(false);
    }
  }

  async function removeInvestorFromYear(inv: { id: number; name: string }) {
    if (
      !window.confirm(
        `להסיר את ${inv.name} מלוח שנת ${year}?\nהמסלול של ${year} והתשלומים שלו יימחקו, והוא לא יופיע בדוח השנתי.`,
      )
    ) {
      return;
    }
    setRemoveBusyId(inv.id);
    setMessage(null);
    try {
      const result = await api.removeFromCalendarYear(year, inv.id);
      setMessage(
        result.deleted_count
          ? `${inv.name} הוסר/ה מלוח ${year} ולא יופיע/ו בדוח`
          : `לא נמצא מסלול של ${inv.name} לשנת ${year}`,
      );
      if (investorId === String(inv.id)) setInvestorId("");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הסרה מהשנה נכשלה");
    } finally {
      setRemoveBusyId(null);
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
      refreshAll();
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
        <button type="button" className="btn" onClick={refreshAll}>
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
            <>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={openBusy}
                onClick={openReportingYear}
              >
                {openBusy ? "פותחים..." : `פתחי לוח ${year}`}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={alignBusy}
                onClick={alignToCalendarYear}
              >
                {alignBusy ? "מיישרים..." : "יישור לתחילת שנה"}
              </button>
            </>
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
            {yearOptions.map((y) => (
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

      <div className="grid-2">
        <Panel title="סיכום שנתי" subtitle={`שנת ${year} · מתוכנן מול שולם`}>
          <div className="stats-grid stats-grid--compact">
            <div className="stat">
              <span className="stat__label">{isManager ? "שולם למשקיעים" : "שולם לי"}</span>
              <strong className="stat__value">
                {formatMoney(yearly?.paid_investor ?? 0)}
              </strong>
            </div>
            <div className="stat">
              <span className="stat__label">מתוכנן לשנה</span>
              <strong className="stat__value">
                {formatMoney(yearly?.planned_investor ?? 0)}
              </strong>
            </div>
            {isManager ? (
              <div className="stat tone-manager">
                <span className="stat__label">עמלות ששולמו</span>
                <strong className="stat__value">
                  {formatMoney(yearly?.paid_manager ?? 0)}
                </strong>
              </div>
            ) : null}
            <div className="stat">
              <span className="stat__label">שולמו / ממתינים</span>
              <strong className="stat__value">
                {yearly?.paid_count ?? 0} / {yearly?.scheduled_count ?? 0}
              </strong>
            </div>
          </div>
        </Panel>

        <Panel title="סיכום סה״כ" subtitle="כל השנים יחד · מה ששולם בפועל">
          <div className="stats-grid stats-grid--compact">
            <div className="stat">
              <span className="stat__label">{isManager ? "סה״כ שולם למשקיעים" : "סה״כ שולם לי"}</span>
              <strong className="stat__value">
                {formatMoney(lifetime?.paid_investor ?? 0)}
              </strong>
            </div>
            <div className="stat">
              <span className="stat__label">סה״כ מתוכנן</span>
              <strong className="stat__value">
                {formatMoney(lifetime?.planned_investor ?? 0)}
              </strong>
            </div>
            {isManager ? (
              <div className="stat tone-manager">
                <span className="stat__label">סה״כ עמלות</span>
                <strong className="stat__value">
                  {formatMoney(lifetime?.paid_manager ?? 0)}
                </strong>
              </div>
            ) : null}
            <div className="stat">
              <span className="stat__label">תשלומים ששולמו</span>
              <strong className="stat__value">{lifetime?.paid_count ?? 0}</strong>
            </div>
          </div>
        </Panel>
      </div>

      {isManager && yearInvestors.length > 0 ? (
        <Panel
          title={`מי בלוח ${year}`}
          subtitle="אם מישהו לא היה במסלול בשנה זו — הסירי אותו מהלוח"
        >
          <ul className="list">
            {yearInvestors.map((inv) => (
              <li key={inv.id} className="list__row">
                <div>
                  <strong>{inv.name}</strong>
                  <span className="muted">מופיע בדוח {year}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--ghost btn--danger"
                  disabled={removeBusyId === inv.id}
                  onClick={() => removeInvestorFromYear(inv)}
                >
                  {removeBusyId === inv.id ? "מסירים..." : "הסירי מהשנה"}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        title={`שנת ${year}`}
        subtitle="מתחילת השנה ועד סופה · לפי חודש קלנדרי"
        action={
          isManager && (yearly?.scheduled_count ?? 0) > 0 ? (
            <button
              type="button"
              className="btn btn--small"
              disabled={markBusy}
              onClick={markEntireYearPaid}
            >
              {markBusy ? "מסמנים..." : "סמני את כל השנה כשולמה"}
            </button>
          ) : null
        }
      >
        {payments.length === 0 ? (
          <div className="empty-block">
            <p className="empty">
              אין רשומות לשנת {year}.{" "}
              {isManager
                ? `לחצי על «פתחי לוח ${year}» כדי ליצור לוח דיווח מלא לפי תנאי המסלולים הקיימים.`
                : "פנו למנהלת לפתיחת לוח הדיווח לשנה זו."}
            </p>
            {isManager ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={openBusy}
                onClick={openReportingYear}
              >
                {openBusy ? "פותחים..." : `פתחי לוח תשלומים ל-${year}`}
              </button>
            ) : null}
          </div>
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
                          <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => markPaid(p.id)}
                          >
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
