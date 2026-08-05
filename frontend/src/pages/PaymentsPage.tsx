import { useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { PlanStatusReportPanel } from "../components/PlanStatusReportPanel";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import {
  formatCalendarMonth,
  formatDate,
  formatMoney,
  formatPercent,
  statusLabel,
} from "../utils/format";
import { downloadYearlyPaymentsPdf } from "../utils/paymentsPdf";
import { planTypeLabel } from "../utils/planTypes";

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
  const [syncBusy, setSyncBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);

  const investorFilter = investorId ? Number(investorId) : undefined;

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );
  const { data: plans, reload: reloadPlans } = useAsync(() => api.plans(), []);
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

  const payments = useMemo(() => {
    const rows = data ?? [];
    const priority: Record<string, number> = {
      paid: 3,
      awaiting_confirmation: 2,
      scheduled: 1,
      skipped: 0,
    };
    const unique = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.investor_id}|${row.due_date}`;
      const prev = unique.get(key);
      if (!prev || (priority[row.status] ?? 0) > (priority[prev.status] ?? 0)) {
        unique.set(key, row);
      }
    }
    return [...unique.values()].sort((a, b) =>
      a.due_date === b.due_date ? a.id - b.id : a.due_date < b.due_date ? -1 : 1,
    );
  }, [data]);
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

  const savingsPlansInView = useMemo(() => {
    const all = (plans ?? []).filter(
      (p) => p.plan_type !== "monthly" && Number(p.savings_rate_percent || 0) > 0,
    );
    if (investorFilter) {
      return all.filter((p) => p.investor_id === investorFilter);
    }
    if (!isManager && user?.investor_id) {
      return all.filter((p) => p.investor_id === user.investor_id);
    }
    const boardIds = new Set(yearInvestors.map((i) => i.id));
    return all.filter(
      (p) =>
        boardIds.has(p.investor_id) ||
        (p.start_date != null && Number(p.start_date.slice(0, 4)) === year) ||
        p.status === "active",
    );
  }, [plans, yearInvestors, investorFilter, isManager, user?.investor_id, year]);

  const savingsByInvestor = useMemo(() => {
    const map = new Map<number, (typeof savingsPlansInView)[number][]>();
    for (const plan of savingsPlansInView) {
      const list = map.get(plan.investor_id) ?? [];
      list.push(plan);
      map.set(plan.investor_id, list);
    }
    return map;
  }, [savingsPlansInView]);

  const statusReportPlans = useMemo(() => {
    const all = plans ?? [];
    if (investorFilter) {
      return all.filter((p) => p.investor_id === investorFilter);
    }
    if (!isManager && user?.investor_id) {
      return all.filter((p) => p.investor_id === user.investor_id);
    }
    const boardIds = new Set(yearInvestors.map((i) => i.id));
    return all.filter(
      (p) =>
        boardIds.has(p.investor_id) ||
        (p.start_date != null && Number(p.start_date.slice(0, 4)) === year),
    );
  }, [plans, investorFilter, isManager, user?.investor_id, yearInvestors, year]);

  async function syncYearAmounts() {
    if (
      !window.confirm(
        `לסנכרן את סכומי התשלומים לשנת ${year} לפי המסלולים הנוכחיים?\nתאריכי התחלה ותאריכי תשלום לא ישתנו — רק הסכומים.`,
      )
    ) {
      return;
    }
    setSyncBusy(true);
    setMessage(null);
    try {
      const result = await api.syncPaymentAmounts({
        year,
        investor_id: investorFilter,
      });
      setMessage(
        result.count
          ? `סונכרנו ${result.count} מסלולים לשנת ${year} — בלי לשנות תאריכים`
          : `לא נמצאו מסלולים לסנכרון לשנת ${year}`,
      );
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סנכרון נכשל");
    } finally {
      setSyncBusy(false);
    }
  }

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
    reloadPlans();
  }

  async function markPaid(id: number) {
    try {
      const updated = await api.updatePayment(id, { status: "paid" });
      setMessage(
        updated.status === "awaiting_confirmation"
          ? "נשלחה בקשת אישור למשקיע — הסטטוס ממתין עד שיאשר"
          : updated.status === "paid"
            ? "התשלום עודכן לבוצע"
            : "הבקשה נשלחה",
      );
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחת בקשת אישור נכשלה");
    }
  }

  async function markScheduled(id: number) {
    await api.updatePayment(id, { status: "scheduled" });
    setMessage("הבקשה בוטלה — חזר לסטטוס מתוכנן");
    refreshAll();
  }

  async function confirmPayment(id: number) {
    try {
      await api.confirmPayment(id);
      setMessage("אישרת את התשלום — הסטטוס עודכן לבוצע");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "אישור התשלום נכשל");
    }
  }

  async function rejectPayment(id: number) {
    try {
      await api.rejectPayment(id);
      setMessage("התשלום נדחה — חזר לסטטוס מתוכנן");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "דחיית התשלום נכשלה");
    }
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
        `לשלוח בקשת אישור לכל התשלומים המתוכננים בשנת ${year}?\nכל משקיע יצטרך לאשר לפני שהסטטוס יהפוך לבוצע.`,
      )
    ) {
      return;
    }
    setMarkBusy(true);
    setMessage(null);
    try {
      const result = await api.markYearPaid(year, investorFilter);
      setMessage(
        result.awaiting_count
          ? `נשלחו ${result.awaiting_count} בקשות אישור לשנת ${year}`
          : result.marked_count
            ? `עודכנו ${result.marked_count} תשלומים לשנת ${year}`
            : `אין תשלומים ממתינים לשנת ${year}`,
      );
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחת בקשות אישור נכשלה");
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
          נסה שוב
        </button>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isManager ? "תשלומים והיסטוריה" : "התשלומים שלי"}</h1>
          <p className="muted">
            {isManager
              ? `דוח שנתי · שליחה לאישור משקיע · 1 בינואר עד 31 בדצמבר ${year}`
              : `התשלומים שלך · אשר קבלה כשמגיעה בקשה · שנת ${year}`}
          </p>
        </div>
        <div className="page-head__actions">
          {isManager ? (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={syncBusy}
                onClick={syncYearAmounts}
              >
                {syncBusy ? "מסנכרנים..." : `סנכרון סכומי ${year}`}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={openBusy}
                onClick={openReportingYear}
              >
                {openBusy ? "פותחים..." : `פתח לוח ${year}`}
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

      {!isManager &&
      payments.some((p) => p.status === "awaiting_confirmation") ? (
        <Panel
          title="ממתין לאישור שלך"
          subtitle="המנהל סימן תשלום — אשר או דחה כדי לעדכן את הסטטוס"
        >
          <ul className="list">
            {payments
              .filter((p) => p.status === "awaiting_confirmation")
              .map((p) => (
                <li key={p.id} className="list__row">
                  <div>
                    <strong>{formatCalendarMonth(p.due_date)}</strong>
                    <span className="muted">
                      {formatDate(p.due_date)} · {formatMoney(p.investor_amount, true)}
                    </span>
                  </div>
                  <div className="page-head__actions">
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => confirmPayment(p.id)}
                    >
                      אשר קבלה
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--danger"
                      onClick={() => rejectPayment(p.id)}
                    >
                      דחה
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}

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
            <option value="awaiting_confirmation">ממתין לאישור</option>
            <option value="paid">בוצע</option>
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
              <span className="stat__label">שולמו / ממתינים לאישור</span>
              <strong className="stat__value">
                {yearly?.paid_count ?? 0} / {yearly?.awaiting_count ?? 0}
              </strong>
            </div>
            <div className="stat">
              <span className="stat__label">מתוכננים</span>
              <strong className="stat__value">{yearly?.scheduled_count ?? 0}</strong>
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
          subtitle="אם מישהו לא היה במסלול בשנה זו — הסר אותו מהלוח"
        >
          <ul className="list">
            {yearInvestors.map((inv) => {
              const savings = savingsByInvestor.get(inv.id) ?? [];
              return (
                <li key={inv.id} className="list__row">
                  <div>
                    <strong>{inv.name}</strong>
                    <span className="muted">מופיע בדוח {year}</span>
                    {savings.length > 0 ? (
                      <span className="muted">
                        {" "}
                        · חיסכון:{" "}
                        {savings
                          .map(
                            (p) =>
                              `${planTypeLabel(p.plan_type)} ${formatPercent(p.savings_rate_percent)} → ${formatMoney(p.projected_savings_balance)}`,
                          )
                          .join(" · ")}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost btn--danger"
                    disabled={removeBusyId === inv.id}
                    onClick={() => removeInvestorFromYear(inv)}
                  >
                    {removeBusyId === inv.id ? "מסירים..." : "הסר מהשנה"}
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {savingsPlansInView.length > 0 ? (
        <Panel
          title={`חיסכון · ${year}`}
          subtitle="מסלולי חיסכון / משולב — ריבית דריבית כל 12 חודשים (לא מופיע כתשלום חודשי במזומן)"
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {isManager ? <th>משקיע</th> : null}
                  <th>סוג</th>
                  <th>קרן</th>
                  <th>אחוז חיסכון</th>
                  {savingsPlansInView.some((p) => p.plan_type === "hybrid") ? (
                    <th>החזר חודשי</th>
                  ) : null}
                  <th>צבירה חודשית</th>
                  <th>יתרה צפויה בסיום</th>
                </tr>
              </thead>
              <tbody>
                {savingsPlansInView.map((p) => (
                  <tr key={p.id}>
                    {isManager ? <td>{p.investor_name}</td> : null}
                    <td>{planTypeLabel(p.plan_type)}</td>
                    <td>{formatMoney(p.principal)}</td>
                    <td>{formatPercent(p.savings_rate_percent)}</td>
                    {savingsPlansInView.some((x) => x.plan_type === "hybrid") ? (
                      <td>
                        {p.plan_type === "hybrid"
                          ? formatMoney(p.monthly_investor_payout, true)
                          : "—"}
                      </td>
                    ) : null}
                    <td>{formatMoney(p.monthly_savings_accrual, true)}</td>
                    <td>{formatMoney(p.projected_savings_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {statusReportPlans.length > 0 ? (
        <Panel
          title="דוח מצב מהמסלול"
          subtitle="לכל חודש מתחילת המסלול: כמה מקבלים במזומן, כמה נכנס לחיסכון, וכמה יש בחיסכון"
        >
          {statusReportPlans.map((p) => (
            <div key={p.id} style={{ marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>
                {p.investor_name} · מסלול #{p.id} · {planTypeLabel(p.plan_type)}
              </h3>
              <PlanStatusReportPanel planId={p.id} />
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel
        title={`שנת ${year}`}
        subtitle="מתחילת השנה ועד סופה · לפי חודש קלנדרי · סכום = החזר חודשי במזומן"
        action={
          isManager && (yearly?.scheduled_count ?? 0) > 0 ? (
            <button
              type="button"
              className="btn btn--small"
              disabled={markBusy}
              onClick={markEntireYearPaid}
            >
              {markBusy ? "שולחים..." : "שלח בקשת אישור לכל השנה"}
            </button>
          ) : null
        }
      >
        {payments.length === 0 ? (
          <div className="empty-block">
            <p className="empty">
              אין רשומות לשנת {year}.{" "}
              {isManager
                ? `לחץ על «פתח לוח ${year}» כדי ליצור לוח דיווח מלא לפי תנאי המסלולים הקיימים.`
                : "פנו למנהל לפתיחת לוח הדיווח לשנה זו."}
            </p>
            {isManager ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={openBusy}
                onClick={openReportingYear}
              >
                {openBusy ? "פותחים..." : `פתח לוח תשלומים ל-${year}`}
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
                  <th></th>
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
                    <td className="table__actions">
                      {isManager ? (
                        p.status === "scheduled" ? (
                          <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => markPaid(p.id)}
                          >
                            שלח לאישור
                          </button>
                        ) : p.status === "awaiting_confirmation" ? (
                          <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => markScheduled(p.id)}
                          >
                            בטל בקשה
                          </button>
                        ) : p.status === "paid" ? (
                          <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => markScheduled(p.id)}
                          >
                            החזר למתוכנן
                          </button>
                        ) : null
                      ) : p.status === "awaiting_confirmation" ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => confirmPayment(p.id)}
                          >
                            אשר קבלה
                          </button>
                          <button
                            type="button"
                            className="btn btn--small btn--ghost btn--danger"
                            onClick={() => rejectPayment(p.id)}
                          >
                            דחה
                          </button>
                        </>
                      ) : null}
                    </td>
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
