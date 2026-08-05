import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../components/Panel";
import { PlanStatusReportPanel } from "../components/PlanStatusReportPanel";
import { Stat } from "../components/Stat";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import {
  formatCalendarMonth,
  formatDate,
  formatMoney,
  formatPercent,
  statusLabel,
  trackEndISO,
} from "../utils/format";
import { downloadYearlyPaymentsPdf } from "../utils/paymentsPdf";
import { planTypeLabel } from "../utils/planTypes";
import type { Plan } from "../types/investments";

type DetailFocus =
  | "yearly-paid"
  | "yearly-planned"
  | "yearly-fees"
  | "yearly-awaiting"
  | "yearly-scheduled"
  | "lifetime-paid"
  | "lifetime-planned"
  | "lifetime-fees"
  | "lifetime-paid-count"
  | "lifetime-savings-now"
  | "lifetime-savings-end";

const DETAIL_LABELS: Record<DetailFocus, string> = {
  "yearly-paid": "שולם למשקיעים (שנתי)",
  "yearly-planned": "מתוכנן לשנה",
  "yearly-fees": "עמלות ששולמו (שנתי)",
  "yearly-awaiting": "ממתינים לאישור",
  "yearly-scheduled": "מתוכננים",
  "lifetime-paid": "סה״כ שולם למשקיעים",
  "lifetime-planned": "סה״כ מתוכנן",
  "lifetime-fees": "סה״כ עמלות",
  "lifetime-paid-count": "תשלומים ששולמו (כל השנים)",
  "lifetime-savings-now": "חיסכון עד עכשיו",
  "lifetime-savings-end": "חיסכון עד סוף מסלול",
};

function primaryPlanForInvestor(
  plans: Plan[] | null | undefined,
  investorId: number,
  year?: number,
): Plan | null {
  const mine = (plans ?? []).filter((p) => p.investor_id === investorId);
  if (mine.length === 0) return null;
  if (year != null) {
    const inYear = mine.filter(
      (p) => p.start_date && Number(p.start_date.slice(0, 4)) === year,
    );
    if (inYear.length > 0) {
      const activeInYear = inYear.find((p) => p.status === "active");
      if (activeInYear) return activeInYear;
      return [...inYear].sort((a, b) =>
        a.start_date < b.start_date ? 1 : -1,
      )[0];
    }
  }
  const active = mine.find((p) => p.status === "active");
  if (active) return active;
  return [...mine].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
}

function planTrackEnd(plan: Plan): string {
  return plan.track_end_date || trackEndISO(plan.start_date, plan.duration_months);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function planCashToDate(plan: Plan): number {
  // Prefer actual paid cash; fall back to elapsed × monthly for hybrid/monthly cash leg.
  if (Number(plan.paid_investor_total || 0) > 0) return Number(plan.paid_investor_total);
  if (plan.plan_type === "savings") return 0;
  return round2(
    Number(plan.monthly_investor_payout || 0) * Number(plan.months_elapsed || 0),
  );
}

function planTotalToDate(plan: Plan): number {
  return round2(planCashToDate(plan) + Number(plan.current_savings_balance || 0));
}

export function PaymentsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const yearNow = new Date().getFullYear();
  const [year, setYear] = useState(yearNow);
  const [status, setStatus] = useState<string>("");
  const [investorId, setInvestorId] = useState<string>("");
  const [allYears, setAllYears] = useState(false);
  const [detailFocus, setDetailFocus] = useState<DetailFocus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [alignBusy, setAlignBusy] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);
  const paymentsPanelRef = useRef<HTMLDivElement | null>(null);
  const savingsPanelRef = useRef<HTMLDivElement | null>(null);

  const investorFilter = investorId ? Number(investorId) : undefined;

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );
  const { data: plans, reload: reloadPlans } = useAsync(() => api.plans(), []);
  const { data, error, loading, reload } = useAsync(
    () =>
      api.payments({
        year: allYears ? undefined : year,
        status: status || undefined,
        investor_id: investorFilter,
      }),
    [year, status, investorFilter, allYears],
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
    let list = all;
    if (investorFilter) {
      list = all.filter((p) => p.investor_id === investorFilter);
    } else if (!isManager && user?.investor_id) {
      list = all.filter((p) => p.investor_id === user.investor_id);
    } else {
      const boardIds = new Set(yearInvestors.map((i) => i.id));
      list = all.filter(
        (p) =>
          boardIds.has(p.investor_id) ||
          (p.start_date != null && Number(p.start_date.slice(0, 4)) === year) ||
          p.status === "active",
      );
    }
    // One clearest track per investor (prefer year match, then active).
    const byInvestor = new Map<number, Plan>();
    const score = (p: Plan) => {
      let s = 0;
      if (p.start_date && Number(p.start_date.slice(0, 4)) === year) s += 4;
      if (p.status === "active") s += 2;
      return s;
    };
    for (const p of list) {
      const cur = byInvestor.get(p.investor_id);
      if (!cur || score(p) > score(cur)) byInvestor.set(p.investor_id, p);
      else if (score(p) === score(cur) && p.start_date > cur.start_date) {
        byInvestor.set(p.investor_id, p);
      }
    }
    // When a specific investor is selected, keep all their savings tracks.
    const result = investorFilter || (!isManager && user?.investor_id)
      ? list
      : [...byInvestor.values()];
    return result.sort((a, b) =>
      a.investor_name.localeCompare(b.investor_name, "he"),
    );
  }, [plans, yearInvestors, investorFilter, isManager, user?.investor_id, year]);

  const savingsTotals = useMemo(() => {
    let cashToDate = 0;
    let savingsToDate = 0;
    let savingsAtEnd = 0;
    let totalAtEnd = 0;
    for (const p of savingsPlansInView) {
      cashToDate += planCashToDate(p);
      savingsToDate += Number(p.current_savings_balance || 0);
      savingsAtEnd += Number(p.projected_savings_balance || 0);
      totalAtEnd += Number(p.total_investor_payout || 0);
    }
    return {
      cashToDate: round2(cashToDate),
      savingsToDate: round2(savingsToDate),
      totalToDate: round2(cashToDate + savingsToDate),
      savingsAtEnd: round2(savingsAtEnd),
      totalAtEnd: round2(totalAtEnd),
    };
  }, [savingsPlansInView]);

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
    let list = all;
    if (investorFilter) {
      list = list.filter((p) => p.investor_id === investorFilter);
    } else if (!isManager && user?.investor_id) {
      list = list.filter((p) => p.investor_id === user.investor_id);
    } else {
      const boardIds = new Set(yearInvestors.map((i) => i.id));
      list = list.filter(
        (p) =>
          boardIds.has(p.investor_id) ||
          (p.start_date != null && Number(p.start_date.slice(0, 4)) === year),
      );
    }
    // Prefer one primary plan per investor — full track terms (not year-clipped).
    const byInvestor = new Map<number, Plan>();
    const score = (p: Plan) => {
      let s = 0;
      if (p.start_date && Number(p.start_date.slice(0, 4)) === year) s += 4;
      if (p.status === "active") s += 2;
      if (p.plan_type !== "monthly") s += 1;
      return s;
    };
    for (const p of list) {
      const current = byInvestor.get(p.investor_id);
      if (!current || score(p) > score(current)) {
        byInvestor.set(p.investor_id, p);
        continue;
      }
      if (score(p) === score(current) && p.start_date > current.start_date) {
        byInvestor.set(p.investor_id, p);
      }
    }
    // Ensure every savings-table track has a status-report target (clickable rows).
    const byId = new Map<number, Plan>();
    for (const p of byInvestor.values()) byId.set(p.id, p);
    for (const p of savingsPlansInView) byId.set(p.id, p);
    return [...byId.values()].sort((a, b) =>
      a.investor_name.localeCompare(b.investor_name, "he"),
    );
  }, [
    plans,
    investorFilter,
    isManager,
    user?.investor_id,
    yearInvestors,
    year,
    savingsPlansInView,
  ]);

  const selectedTrackPlan = useMemo(() => {
    if (!investorFilter) return null;
    return primaryPlanForInvestor(plans, investorFilter, year);
  }, [plans, investorFilter, year]);

  function clearDetailFocus() {
    setDetailFocus(null);
    setAllYears(false);
  }

  function openDetail(focus: DetailFocus) {
    setDetailFocus(focus);
    const isLifetime = focus.startsWith("lifetime-");
    const isSavings =
      focus === "lifetime-savings-now" || focus === "lifetime-savings-end";

    if (isSavings) {
      setAllYears(false);
      setStatus("");
      window.setTimeout(() => {
        savingsPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
      return;
    }

    setAllYears(isLifetime);
    if (
      focus === "yearly-paid" ||
      focus === "yearly-fees" ||
      focus === "lifetime-paid" ||
      focus === "lifetime-fees" ||
      focus === "lifetime-paid-count"
    ) {
      setStatus("paid");
    } else if (focus === "yearly-awaiting") {
      setStatus("awaiting_confirmation");
    } else if (focus === "yearly-scheduled") {
      setStatus("scheduled");
    } else {
      // planned totals = all statuses in scope
      setStatus("");
    }
  }

  useEffect(() => {
    if (!detailFocus) return;
    if (
      detailFocus === "lifetime-savings-now" ||
      detailFocus === "lifetime-savings-end"
    ) {
      return;
    }
    const t = window.setTimeout(() => {
      paymentsPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [detailFocus, allYears, status, data]);

  function focusStatusReport(planId: number) {
    setDetailFocus(null);
    window.setTimeout(() => {
      document
        .getElementById(`status-report-plan-${planId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

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
        `לפתוח לוח תשלומים לשנת ${year}?\nלכל משקיע ייווצר לוח מתחילת המסלול שלו לפי תנאי המסלול (משך מלא) — בלי חודשים שלפני ההתחלה.`,
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
              ? selectedTrackPlan
                ? `דוח שנתי · ${selectedInvestorName ?? "משקיע"} · תחילת מסלול ${formatCalendarMonth(selectedTrackPlan.start_date)} ${selectedTrackPlan.start_date.slice(0, 4)} עד סוף מסלול ${formatCalendarMonth(planTrackEnd(selectedTrackPlan))} ${planTrackEnd(selectedTrackPlan).slice(0, 4)} (${selectedTrackPlan.duration_months} חודשים)`
                : `דוח שנתי · שליחה לאישור משקיע · שנת ${year} · לכל משקיע לפי תחילת וסוף המסלול שלו`
              : selectedTrackPlan
                ? `המסלול שלך · ${formatCalendarMonth(selectedTrackPlan.start_date)} עד ${formatCalendarMonth(planTrackEnd(selectedTrackPlan))} · שנת ${year}`
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
          <select
            value={allYears ? "all" : String(year)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "all") {
                setAllYears(true);
                setDetailFocus((prev) => prev ?? "lifetime-planned");
                return;
              }
              setAllYears(false);
              setYear(Number(v));
              setDetailFocus(null);
            }}
          >
            <option value="all">כל השנים</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          סטטוס
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setDetailFocus(null);
            }}
          >
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
            <select
              value={investorId}
              onChange={(e) => {
                setInvestorId(e.target.value);
                setDetailFocus(null);
              }}
            >
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
        <Panel
          title="סיכום שנתי"
          subtitle={`שנת ${year} · לחצו על משבצת לפירוט`}
        >
          <div className="stats-grid stats-grid--compact">
            <Stat
              label={isManager ? "שולם למשקיעים" : "שולם לי"}
              value={formatMoney(yearly?.paid_investor ?? 0)}
              active={detailFocus === "yearly-paid"}
              onClick={() => openDetail("yearly-paid")}
            />
            <Stat
              label="מתוכנן לשנה"
              value={formatMoney(yearly?.planned_investor ?? 0)}
              active={detailFocus === "yearly-planned"}
              onClick={() => openDetail("yearly-planned")}
            />
            {isManager ? (
              <Stat
                label="עמלות ששולמו"
                value={formatMoney(yearly?.paid_manager ?? 0)}
                tone="manager"
                active={detailFocus === "yearly-fees"}
                onClick={() => openDetail("yearly-fees")}
              />
            ) : null}
            <Stat
              label="שולמו / ממתינים לאישור"
              value={`${yearly?.paid_count ?? 0} / ${yearly?.awaiting_count ?? 0}`}
              hint="לחיצה מציגה ממתינים לאישור"
              active={detailFocus === "yearly-awaiting"}
              onClick={() => openDetail("yearly-awaiting")}
            />
            <Stat
              label="מתוכננים"
              value={String(yearly?.scheduled_count ?? 0)}
              active={detailFocus === "yearly-scheduled"}
              onClick={() => openDetail("yearly-scheduled")}
            />
          </div>
        </Panel>

        <Panel
          title="סיכום סה״כ"
          subtitle="כל השנים · לחצו על משבצת לפירוט"
        >
          <div className="stats-grid stats-grid--compact">
            <Stat
              label={isManager ? "סה״כ שולם למשקיעים" : "סה״כ שולם לי"}
              value={formatMoney(lifetime?.paid_investor ?? 0)}
              active={detailFocus === "lifetime-paid"}
              onClick={() => openDetail("lifetime-paid")}
            />
            <Stat
              label="סה״כ מתוכנן"
              value={formatMoney(lifetime?.planned_investor ?? 0)}
              active={detailFocus === "lifetime-planned"}
              onClick={() => openDetail("lifetime-planned")}
            />
            {isManager ? (
              <Stat
                label="סה״כ עמלות"
                value={formatMoney(lifetime?.paid_manager ?? 0)}
                tone="manager"
                active={detailFocus === "lifetime-fees"}
                onClick={() => openDetail("lifetime-fees")}
              />
            ) : null}
            <Stat
              label="תשלומים ששולמו"
              value={String(lifetime?.paid_count ?? 0)}
              active={detailFocus === "lifetime-paid-count"}
              onClick={() => openDetail("lifetime-paid-count")}
            />
            <Stat
              label="חיסכון עד עכשיו"
              value={formatMoney(lifetime?.savings_to_date ?? 0)}
              active={detailFocus === "lifetime-savings-now"}
              onClick={() => openDetail("lifetime-savings-now")}
            />
            <Stat
              label="חיסכון עד סוף מסלול"
              value={formatMoney(lifetime?.savings_to_track_end ?? 0)}
              active={detailFocus === "lifetime-savings-end"}
              onClick={() => openDetail("lifetime-savings-end")}
            />
          </div>
        </Panel>
      </div>

      {detailFocus ? (
        <div className="detail-focus-banner" role="status">
          <div>
            <strong>פירוט: {DETAIL_LABELS[detailFocus]}</strong>
            <span className="muted">
              {" · "}
              {detailFocus.startsWith("lifetime-")
                ? "כל השנים"
                : `שנת ${year}`}
              {status ? ` · סטטוס: ${statusLabel(status)}` : " · כל הסטטוסים"}
              {selectedInvestorName ? ` · ${selectedInvestorName}` : ""}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={clearDetailFocus}
          >
            נקה סינון
          </button>
        </div>
      ) : null}

      {isManager && yearInvestors.length > 0 ? (
        <Panel
          title={`מי בלוח ${year}`}
          subtitle="לכל משקיע — תחילת מסלול וסוף מסלול לפי תנאי המסלול (לא בהכרח עד סוף השנה)"
        >
          <ul className="list">
            {yearInvestors.map((inv) => {
              const savings = savingsByInvestor.get(inv.id) ?? [];
              const track = primaryPlanForInvestor(plans, inv.id, year);
              const end = track ? planTrackEnd(track) : null;
              return (
                <li key={inv.id} className="list__row">
                  <div>
                    <strong>{inv.name}</strong>
                    {track ? (
                      <span className="muted">
                        {" "}
                        · תחילת מסלול: {formatCalendarMonth(track.start_date)}{" "}
                        {track.start_date.slice(0, 4)}
                        {" · "}
                        סוף מסלול: {formatCalendarMonth(end)} {end?.slice(0, 4)}
                        {" · "}
                        {track.duration_months} חודשים
                      </span>
                    ) : (
                      <span className="muted">מופיע בדוח {year}</span>
                    )}
                    {savings.length > 0 ? (
                      <span className="muted">
                        {" "}
                        · חיסכון:{" "}
                        {savings
                          .map(
                            (p) =>
                              `${planTypeLabel(p.plan_type)} עד עכשיו ${formatMoney(p.current_savings_balance ?? 0)} / עד סוף ${formatMoney(p.projected_savings_balance)}`,
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
        <div
          ref={savingsPanelRef}
          className={
            detailFocus === "lifetime-savings-now" ||
            detailFocus === "lifetime-savings-end"
              ? "detail-target detail-target--active"
              : undefined
          }
        >
        <Panel
          title={
            detailFocus === "lifetime-savings-now"
              ? "פירוט · חיסכון עד עכשיו"
              : detailFocus === "lifetime-savings-end"
                ? "פירוט · חיסכון עד סוף מסלול"
                : "חיסכון · לפי תנאי מסלול"
          }
          subtitle="כמה נצבר עד עכשיו בתקופת המסלול (מזומן + חיסכון) · לחצו על שורה לפירוט חודשי"
        >
          <div className="stats-grid stats-grid--compact savings-summary-stats">
            <div className="stat">
              <span className="stat__label">מזומן שנצבר עד עכשיו</span>
              <strong className="stat__value">
                {formatMoney(savingsTotals.cashToDate)}
              </strong>
            </div>
            <div
              className={`stat${detailFocus === "lifetime-savings-now" ? " stat--active" : ""}`}
            >
              <span className="stat__label">חיסכון שנצבר עד עכשיו</span>
              <strong className="stat__value">
                {formatMoney(savingsTotals.savingsToDate)}
              </strong>
            </div>
            <div className="stat tone-accent">
              <span className="stat__label">סה״כ עד עכשיו</span>
              <strong className="stat__value">
                {formatMoney(savingsTotals.totalToDate)}
              </strong>
              <span className="stat__hint">מזומן ששולם + יתרת חיסכון</span>
            </div>
            <div
              className={`stat${detailFocus === "lifetime-savings-end" ? " stat--active" : ""}`}
            >
              <span className="stat__label">צפוי בסיום מסלול</span>
              <strong className="stat__value">
                {formatMoney(savingsTotals.totalAtEnd)}
              </strong>
              <span className="stat__hint">
                כולל חיסכון {formatMoney(savingsTotals.savingsAtEnd)}
              </span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table table--clickable-rows">
              <thead>
                <tr>
                  {isManager ? <th>משקיע</th> : null}
                  <th>מסלול</th>
                  <th>תקופה במסלול</th>
                  <th>קרן</th>
                  <th>מזומן עד עכשיו</th>
                  <th
                    className={
                      detailFocus === "lifetime-savings-now"
                        ? "col-highlight"
                        : undefined
                    }
                  >
                    חיסכון עד עכשיו
                  </th>
                  <th className="col-highlight">סה״כ עד עכשיו</th>
                  <th
                    className={
                      detailFocus === "lifetime-savings-end"
                        ? "col-highlight"
                        : undefined
                    }
                  >
                    צפוי בסיום
                  </th>
                </tr>
              </thead>
              <tbody>
                {savingsPlansInView.map((p) => {
                  const cash = planCashToDate(p);
                  const sav = Number(p.current_savings_balance || 0);
                  const totalNow = planTotalToDate(p);
                  const endTotal = Number(p.total_investor_payout || 0);
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      role="link"
                      title="מעבר לפירוט חודשי של המסלול"
                      onClick={() => focusStatusReport(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          focusStatusReport(p.id);
                        }
                      }}
                    >
                      {isManager ? <td>{p.investor_name}</td> : null}
                      <td>
                        <strong>{planTypeLabel(p.plan_type)}</strong>
                        <div className="muted">
                          מסלול #{p.id}
                          {p.status === "active" ? " · פעיל" : ""}
                          {" · "}
                          {formatPercent(p.savings_rate_percent)} חיסכון
                          {p.plan_type === "hybrid"
                            ? ` · ${formatMoney(p.monthly_investor_payout, true)}/ח׳ מזומן`
                            : ""}
                        </div>
                      </td>
                      <td>
                        <div>
                          {formatCalendarMonth(p.start_date)}{" "}
                          {p.start_date.slice(0, 4)}
                          {" → "}
                          {formatCalendarMonth(planTrackEnd(p))}{" "}
                          {planTrackEnd(p).slice(0, 4)}
                        </div>
                        <div className="muted">
                          {p.months_elapsed}/{p.duration_months} חודשים חלפו
                          {p.months_remaining > 0
                            ? ` · נותרו ${p.months_remaining}`
                            : " · הסתיים"}
                        </div>
                      </td>
                      <td>{formatMoney(p.principal)}</td>
                      <td>
                        {formatMoney(cash)}
                        {p.plan_type !== "savings" ? (
                          <div className="muted">
                            {formatMoney(p.monthly_investor_payout, true)} ×{" "}
                            {p.months_elapsed || p.paid_count || 0}
                          </div>
                        ) : (
                          <div className="muted">אין מזומן חודשי</div>
                        )}
                      </td>
                      <td
                        className={
                          detailFocus === "lifetime-savings-now"
                            ? "col-highlight"
                            : undefined
                        }
                      >
                        {formatMoney(sav)}
                        <div className="muted">
                          {formatMoney(p.monthly_savings_accrual, true)}/ח׳
                        </div>
                      </td>
                      <td className="col-highlight">
                        <strong>{formatMoney(totalNow)}</strong>
                        <div className="muted">מזומן + חיסכון</div>
                      </td>
                      <td
                        className={
                          detailFocus === "lifetime-savings-end"
                            ? "col-highlight"
                            : undefined
                        }
                      >
                        {formatMoney(endTotal)}
                        <div className="muted">
                          חיסכון {formatMoney(p.projected_savings_balance)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={isManager ? 4 : 3}>
                    <strong>סה״כ בטבלה</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(savingsTotals.cashToDate)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(savingsTotals.savingsToDate)}</strong>
                  </td>
                  <td className="col-highlight">
                    <strong>{formatMoney(savingsTotals.totalToDate)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(savingsTotals.totalAtEnd)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
        </div>
      ) : null}

      {statusReportPlans.length > 0 ? (
        <Panel
          title="דוח מצב · מתחילת מסלול עד סוף מסלול"
          subtitle="לפי תנאי המסלול של כל משקיע — בלי חודשים שלפני ההתחלה ובלי קיצוץ מלאכותי לסוף שנה"
        >
          {statusReportPlans.map((p) => (
            <div
              key={p.id}
              id={`status-report-plan-${p.id}`}
              style={{ marginBottom: 18 }}
            >
              <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>
                {p.investor_name} · מסלול #{p.id} · {planTypeLabel(p.plan_type)}
                {" · "}
                {formatCalendarMonth(p.start_date)} →{" "}
                {formatCalendarMonth(planTrackEnd(p))} ({p.duration_months} ח׳)
              </h3>
              <PlanStatusReportPanel planId={p.id} />
            </div>
          ))}
        </Panel>
      ) : null}

      <div
        ref={paymentsPanelRef}
        className={
          detailFocus &&
          detailFocus !== "lifetime-savings-now" &&
          detailFocus !== "lifetime-savings-end"
            ? "detail-target detail-target--active"
            : undefined
        }
      >
      <Panel
        title={
          detailFocus &&
          detailFocus !== "lifetime-savings-now" &&
          detailFocus !== "lifetime-savings-end"
            ? `פירוט · ${DETAIL_LABELS[detailFocus]}`
            : allYears
              ? "תשלומים · כל השנים"
              : `תשלומי ${year}`
        }
        subtitle={
          detailFocus === "yearly-fees" || detailFocus === "lifetime-fees"
            ? "תשלומים שבוצעו · עמלה בעמודה ייעודית"
            : allYears
              ? "כל התשלומים בכל השנים · מסונן לפי המשבצת שנבחרה"
              : "תשלומי מזומן שחלים בשנה זו · רק חודשים שהמשקיע במסלול בהם"
        }
        action={
          isManager && !allYears && (yearly?.scheduled_count ?? 0) > 0 ? (
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
              {detailFocus
                ? `אין רשומות לפירוט «${DETAIL_LABELS[detailFocus]}».`
                : allYears
                  ? "אין רשומות לכל השנים עם הסינון הנוכחי."
                  : `אין רשומות לשנת ${year}. `}
              {!detailFocus && !allYears && isManager
                ? `לחץ על «פתח לוח ${year}» כדי ליצור לוח דיווח מלא לפי תנאי המסלולים הקיימים.`
                : !detailFocus && !allYears
                  ? "פנו למנהל לפתיחת לוח הדיווח לשנה זו."
                  : null}
            </p>
            {isManager && !allYears && !detailFocus ? (
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
                  {allYears ? <th>שנה</th> : null}
                  <th>חודש</th>
                  <th>תאריך</th>
                  <th
                    className={
                      detailFocus === "yearly-paid" ||
                      detailFocus === "lifetime-paid"
                        ? "col-highlight"
                        : undefined
                    }
                  >
                    סכום
                  </th>
                  {isManager ? (
                    <th
                      className={
                        detailFocus === "yearly-fees" ||
                        detailFocus === "lifetime-fees"
                          ? "col-highlight"
                          : undefined
                      }
                    >
                      עמלה
                    </th>
                  ) : null}
                  <th>סטטוס</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    {isManager ? <td>{p.investor_name}</td> : null}
                    {allYears ? <td>{p.due_date.slice(0, 4)}</td> : null}
                    <td>{formatCalendarMonth(p.due_date)}</td>
                    <td>{formatDate(p.due_date)}</td>
                    <td
                      className={
                        detailFocus === "yearly-paid" ||
                        detailFocus === "lifetime-paid"
                          ? "col-highlight"
                          : undefined
                      }
                    >
                      {formatMoney(p.investor_amount, true)}
                    </td>
                    {isManager ? (
                      <td
                        className={
                          detailFocus === "yearly-fees" ||
                          detailFocus === "lifetime-fees"
                            ? "col-highlight"
                            : undefined
                        }
                      >
                        {formatMoney(p.manager_amount, true)}
                      </td>
                    ) : null}
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
    </div>
  );
}
