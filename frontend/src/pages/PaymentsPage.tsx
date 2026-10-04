import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useConfirm } from "../components/ConfirmDialog";
import { Panel } from "../components/Panel";
import { PaymentCeremonyCard } from "../components/PaymentCeremonyCard";
import { PlanStatusReportPanel } from "../components/PlanStatusReportPanel";
import { ScrollReveal } from "../components/motion/ScrollReveal";
import { Stat } from "../components/Stat";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import {
  formatCalendarMonth,
  formatDate,
  formatMoney,
  formatPercent,
  statusLabel,
  todayISO,
  trackEndISO,
} from "../utils/format";
import { downloadMonthlyReportPdf } from "../utils/monthlyReportPdf";
import { downloadYearlyPaymentsPdf } from "../utils/paymentsPdf";
import { planTypeLabel } from "../utils/planTypes";
import { isAdminShellInvestor } from "../utils/roles";
import { buildPaymentDisplayRows, isClosedPaymentPlan } from "../utils/paymentDisplay";
import {
  hasPaymentsFocus,
  parsePaymentsFocusSearch,
  paymentsFocusSearchKey,
} from "../utils/paymentOps";
import type { Plan } from "../types/investments";
import "./paymentClarity.css";
import "./paymentHistoryToggle.css";

function visibleFocusEl(selector: string): HTMLElement | null {
  const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
  return nodes.find((n) => n.getClientRects().length > 0) ?? nodes[0] ?? null;
}

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
  return Number(plan.paid_investor_total || 0);
}

function planTotalToDate(plan: Plan): number {
  return round2(planCashToDate(plan) + Number(plan.current_savings_balance || 0));
}

export function PaymentsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [searchParams] = useSearchParams();
  const yearNow = new Date().getFullYear();
  const incomingFocus = parsePaymentsFocusSearch(searchParams);
  const [year, setYear] = useState(incomingFocus.year ?? yearNow);
  const [status, setStatus] = useState<string>(incomingFocus.status ?? "");
  const [investorId, setInvestorId] = useState<string>(incomingFocus.investorId);
  const [focusPaymentId, setFocusPaymentId] = useState<number | null>(incomingFocus.paymentId);
  const [focusMonth, setFocusMonth] = useState<string | null>(incomingFocus.month);
  const [allYears, setAllYears] = useState(false);
  const [showCancellationHistory, setShowCancellationHistory] = useState(false);
  const appliedSearchRef = useRef<string | null>(null);
  const scrolledFocusRef = useRef("");
  const [detailFocus, setDetailFocus] = useState<DetailFocus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const [markBusyId, setMarkBusyId] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);
  const [manageYear, setManageYear] = useState(false);
  const paymentsPanelRef = useRef<HTMLDivElement | null>(null);
  const savingsPanelRef = useRef<HTMLDivElement | null>(null);
  const savingsDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const reportsDisclosureRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const key = paymentsFocusSearchKey(searchParams);
    if (appliedSearchRef.current === key) return;
    const prev = appliedSearchRef.current;
    appliedSearchRef.current = key;
    const focus = parsePaymentsFocusSearch(searchParams);
    if (!hasPaymentsFocus(focus)) {
      if (prev) {
        setInvestorId("");
        setStatus("");
        setYear(yearNow);
        setAllYears(false);
        setFocusPaymentId(null);
        setFocusMonth(null);
      }
      return;
    }
    scrolledFocusRef.current = "";
    if (focus.year) setYear(focus.year);
    setStatus(focus.status ?? "");
    setInvestorId(focus.investorId);
    setAllYears(false);
    setDetailFocus(null);
    setFocusPaymentId(focus.paymentId);
    setFocusMonth(focus.month);
  }, [searchParams, yearNow]);

  const investorFilter = investorId ? Number(investorId) : undefined;

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );
  const { data: plans, reload: reloadPlans } = useAsync(() => api.plans(), []);
  const { data, error, loading, refreshing, reload } = useAsync(
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
    // Dedupe only within the same plan + due date (never drop another plan's row).
    const unique = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.plan_id ?? "none"}|${row.investor_id}|${row.due_date}`;
      const prev = unique.get(key);
      if (!prev || (priority[row.status] ?? 0) > (priority[prev.status] ?? 0)) {
        unique.set(key, row);
      }
    }
    return [...unique.values()].sort((a, b) =>
      a.due_date === b.due_date ? a.id - b.id : a.due_date < b.due_date ? -1 : 1,
    );
  }, [data]);

  const displayedRows = useMemo(() => buildPaymentDisplayRows(payments, plans ?? [], {
    year: allYears ? undefined : year,
    investorId: investorFilter ?? (!isManager ? user?.investor_id ?? undefined : undefined),
    status,
    showCancelled: showCancellationHistory || allYears || status === "skipped",
  }), [payments, plans, allYears, year, investorFilter, isManager, user?.investor_id, status, showCancellationHistory]);
  const closedPlanIds = useMemo(() => new Set((plans ?? []).filter(isClosedPaymentPlan).map((p) => p.id)), [plans]);

  function paymentDisplayStatus(payment: (typeof payments)[number]) {
    if (!isManager && payment.status === "scheduled" && !payment.date_amendment_pending && payment.due_date < todayISO()) {
      return "טרם הושלם · המועד עבר";
    }
    return payment.status === "skipped" && closedPlanIds.has(payment.plan_id)
      ? "בוטל בסיום המסלול" : statusLabel(payment.status);
  }

  const yearScopePayments = (yearAll ?? []).filter(
    (p) => !investorFilter || p.investor_id === investorFilter,
  );
  const frozenYearBatch = yearScopePayments.some(
    (p) => p.status === "scheduled" && p.date_amendment_pending,
  );
  const frozenYearAmounts = yearScopePayments.some((p) => p.date_amendment_pending)
    || (plans ?? []).some((p) => p.date_amendment_pending
      && (!investorFilter || p.investor_id === investorFilter)
      && Number(p.start_date.slice(0, 4)) === year);

  useEffect(() => {
    if (!focusPaymentId && !focusMonth) return;
    if (loading) return;
    const token = `${focusPaymentId ?? ""}|${focusMonth ?? ""}|${investorId}|${year}|${payments.length}`;
    if (scrolledFocusRef.current === token) return;

    const findTarget = (): HTMLElement | null => {
      if (focusPaymentId) {
        const byId = visibleFocusEl(`[data-payment-id="${focusPaymentId}"]`);
        if (byId) return byId;
      }
      if (!focusMonth) return null;
      const monthMatches = [
        ...document.querySelectorAll<HTMLElement>(`[data-payment-month="${focusMonth}"]`),
      ];
      const forInvestor = investorId
        ? monthMatches.filter((n) => n.dataset.investorId === investorId)
        : monthMatches;
      return forInvestor.find((n) => n.getClientRects().length > 0) ?? forInvestor[0] ?? null;
    };

    const timers: number[] = [];
    const reveal = (el: HTMLElement) => {
      el.classList.add("is-target");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledFocusRef.current = token;
    };

    const attempt = () => {
      const el = findTarget();
      if (!el) {
        if (payments.length === 0) {
          paymentsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          scrolledFocusRef.current = token;
        }
        return;
      }
      reveal(el);
      // Status-report / savings panels load after the list and push the row down.
      timers.push(
        window.setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 700),
      );
      timers.push(window.setTimeout(() => el.classList.remove("is-target"), 4200));
    };

    timers.push(window.setTimeout(attempt, 80));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [loading, payments, focusPaymentId, focusMonth, investorId, year]);

  const yearly = report?.yearly;
  const lifetime = report?.lifetime;

  const yearInvestors = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of yearAll ?? []) {
      map.set(p.investor_id, p.investor_name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .filter((inv) => !isAdminShellInvestor(inv))
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

  const activeSavingsPlans = useMemo(
    () => savingsPlansInView.filter((p) => p.status !== "completed"),
    [savingsPlansInView],
  );
  const closedSavingsPlans = useMemo(
    () =>
      savingsPlansInView
        .filter((p) => p.status === "completed")
        .sort((a, b) => (a.start_date < b.start_date ? 1 : -1)),
    [savingsPlansInView],
  );

  const savingsTotals = useMemo(() => {
    let cashToDate = 0;
    let savingsToDate = 0;
    let savingsAtEnd = 0;
    let totalAtEnd = 0;
    for (const p of activeSavingsPlans) {
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
  }, [activeSavingsPlans]);

  const savingsByInvestorCards = useMemo(() => {
    const map = new Map<
      number,
      { id: number; name: string; plans: Plan[] }
    >();
    for (const p of activeSavingsPlans) {
      const cur = map.get(p.investor_id);
      if (cur) cur.plans.push(p);
      else {
        map.set(p.investor_id, {
          id: p.investor_id,
          name: p.investor_name,
          plans: [p],
        });
      }
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        plans: [...g.plans].sort((a, b) =>
          a.start_date < b.start_date ? 1 : -1,
        ),
        cashToDate: round2(g.plans.reduce((s, p) => s + planCashToDate(p), 0)),
        savingsToDate: round2(
          g.plans.reduce((s, p) => s + Number(p.current_savings_balance || 0), 0),
        ),
        totalToDate: round2(
          g.plans.reduce((s, p) => s + planTotalToDate(p), 0),
        ),
        totalAtEnd: round2(
          g.plans.reduce((s, p) => s + Number(p.total_investor_payout || 0), 0),
        ),
        savingsAtEnd: round2(
          g.plans.reduce(
            (s, p) => s + Number(p.projected_savings_balance || 0),
            0,
          ),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [activeSavingsPlans]);

  const savingsByInvestor = useMemo(() => {
    const map = new Map<number, (typeof activeSavingsPlans)[number][]>();
    for (const plan of activeSavingsPlans) {
      const list = map.get(plan.investor_id) ?? [];
      list.push(plan);
      map.set(plan.investor_id, list);
    }
    return map;
  }, [activeSavingsPlans]);

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
      if (savingsDisclosureRef.current) savingsDisclosureRef.current.open = true;
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
    if (reportsDisclosureRef.current) reportsDisclosureRef.current.open = true;
    window.setTimeout(() => {
      const target = document.getElementById(`status-report-plan-${planId}`);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  async function syncYearAmounts() {
    if (frozenYearAmounts) {
      setMessage("סנכרון הסכומים ממתין לחתימה או לביטול הסכם עדכון מועדי המסלול.");
      return;
    }
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
    const set = new Set<number>([...fromApi, yearNow, yearNow - 1, yearNow - 2, 2025, year]);
    return [...set].sort((a, b) => b - a);
  }, [report?.available_years, yearNow, year]);

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
    if (paymentAwaitingDateAmendment(id)) return;
    setMarkBusyId(id);
    setMessage(null);
    try {
      const updated = await api.updatePayment(id, { status: "paid" });
      setMessage(
        updated.status === "awaiting_confirmation"
          ? "נשלחה בקשת אישור למשקיע — הסטטוס ממתין עד שיאשר"
          : updated.status === "paid"
            ? "התשלום שלך עודכן ישירות לבוצע (בלי צורך באישור עצמי)"
            : "הבקשה נשלחה",
      );
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחת בקשת אישור נכשלה");
    } finally {
      setMarkBusyId(null);
    }
  }

  async function markScheduled(id: number) {
    if (paymentAwaitingDateAmendment(id)) return;
    setMarkBusyId(id);
    setMessage(null);
    try {
      await api.updatePayment(id, { status: "scheduled" });
      setMessage("הבקשה בוטלה — חזר לסטטוס מתוכנן");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ביטול הבקשה נכשל");
    } finally {
      setMarkBusyId(null);
    }
  }

  async function confirmPayment(id: number) {
    if (paymentAwaitingDateAmendment(id)) return;
    const payment = payments.find((p) => p.id === id);
    const ok = await confirm({
      title: "קיבלתי את ההעברה",
      message: payment
        ? `לאשר שקיבלת ${formatMoney(payment.investor_amount, true)} עבור ${formatCalendarMonth(payment.due_date)}?`
        : "לאשר שקיבלת את ההעברה?",
      confirmLabel: "קיבלתי את ההעברה",
    });
    if (!ok) return;
    setMarkBusyId(id);
    setMessage(null);
    try {
      await api.confirmPayment(id);
      setMessage("רשמנו שקיבלת את ההעברה");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "אישור ההעברה נכשל");
    } finally {
      setMarkBusyId(null);
    }
  }

  async function rejectPayment(id: number) {
    if (paymentAwaitingDateAmendment(id)) return;
    const payment = payments.find((p) => p.id === id);
    const ok = await confirm({
      title: "עדיין לא הגיע",
      message: payment
        ? `לציין שסכום ${formatMoney(payment.investor_amount, true)} עדיין לא הגיע? נחזור לבדוק.`
        : "לציין שההעברה עדיין לא הגיעה?",
      confirmLabel: "עדיין לא הגיע",
    });
    if (!ok) return;
    setMarkBusyId(id);
    setMessage(null);
    try {
      await api.rejectPayment(id);
      setMessage("ציינו שעדיין לא הגיע — נבדוק ונחזור אליך");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון הסטטוס נכשל");
    } finally {
      setMarkBusyId(null);
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

  async function exportMonthlyPdf() {
    setPdfBusy(true);
    setMessage(null);
    try {
      const board = await api.dashboard(
        isManager && investorFilter ? { investor_id: investorFilter } : undefined,
      );
      const yearPayments = await api.payments({
        year: new Date().getFullYear(),
        investor_id: investorFilter,
      });
      await downloadMonthlyReportPdf({
        dashboard: board,
        payments: yearPayments,
        investorName:
          selectedInvestorName ||
          user?.investor_name ||
          user?.username ||
          "תיק פרטי",
      });
      setMessage("הדוח החודשי ירד בהצלחה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ייצוא הדוח החודשי נכשל");
    } finally {
      setPdfBusy(false);
    }
  }

  async function markEntireYearPaid() {
    if (frozenYearBatch) {
      setMessage("שליחה לכל השנה ממתינה לחתימה או לביטול הסכם עדכון מועדים. ניתן לשלוח בנפרד תשלומים ממסלולים אחרים.");
      return;
    }
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

  function paymentAwaitingDateAmendment(id: number) {
    if (!payments.find((p) => p.id === id)?.date_amendment_pending) return false;
    setMessage("התשלום ממתין לחתימת הסכם עדכון מועדי המסלול. ניתן להמשיך לאחר החתימה או ביטול ההסכם.");
    return true;
  }

  function paymentRowActions(p: (typeof payments)[number]) {
    if (isManager) {
      if (p.status === "scheduled") {
        return (
          <button
            type="button"
            className="btn btn--small btn--admin"
            disabled={markBusyId === p.id || p.date_amendment_pending}
            onClick={() => markPaid(p.id)}
          >
            {markBusyId === p.id ? "שולח..." : "שלח לאישור"}
          </button>
        );
      }
      if (p.status === "awaiting_confirmation") {
        return (
          <button
            type="button"
            className="btn btn--small btn--ghost"
            disabled={markBusyId === p.id || p.date_amendment_pending}
            onClick={() => markScheduled(p.id)}
          >
            {markBusyId === p.id ? "מבטל..." : "בטל בקשה"}
          </button>
        );
      }
      if (p.status === "paid") {
        return (
          <button
            type="button"
            className="btn btn--small btn--ghost"
            disabled={markBusyId === p.id || p.date_amendment_pending}
            onClick={() => markScheduled(p.id)}
          >
            {markBusyId === p.id ? "מעדכן..." : "החזר למתוכנן"}
          </button>
        );
      }
      return null;
    }
    if (p.status === "awaiting_confirmation") {
      return (
        <>
          <button
            type="button"
            className="btn btn--small btn--gold"
            disabled={markBusyId === p.id || p.date_amendment_pending}
            onClick={() => confirmPayment(p.id)}
          >
            {markBusyId === p.id ? "רושם..." : "קיבלתי את ההעברה"}
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            disabled={markBusyId === p.id || p.date_amendment_pending}
            onClick={() => rejectPayment(p.id)}
          >
            עדיין לא הגיע
          </button>
        </>
      );
    }
    return null;
  }

  if (loading && !data) return <div className="state state--loading">טוען היסטוריית תשלומים...</div>;
  if (error && !data)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={refreshAll}>
          נסה שוב
        </button>
      </div>
    );

  return (
    <div className={`page payments-page${refreshing ? " page--refreshing" : ""}`}>
      {confirmDialog}
      <Toast message={message} onClear={clearMessage} />
      <ScrollReveal>
      <header className="page-intro">
        <div>
          <h1 className="page-intro__title">
            {isManager ? "תשלומים והיסטוריה" : "התשלומים שלך"}
          </h1>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className={`btn ${isManager ? "btn--admin" : "btn--gold"}`}
            disabled={pdfBusy}
            onClick={() => void exportMonthlyPdf()}
          >
            {pdfBusy ? "מכינים PDF..." : "דוח חודשי"}
          </button>
          <button
            type="button"
            className="btn btn--ghost hide-on-phone"
            disabled={pdfBusy}
            onClick={exportYearPdf}
          >
            {pdfBusy ? "מכינים PDF..." : `דוח שנתי ${year}`}
          </button>
          {isManager ? (
            <details className="tools-menu">
              <summary className="btn btn--ghost btn--admin-outline">פעולות ניהול</summary>
              <div className="tools-menu__list">
                <button
                  type="button"
                  className="tools-menu__item"
                  disabled={syncBusy || frozenYearAmounts}
                  title={frozenYearAmounts ? "ממתין לחתימת הסכם עדכון מועדים" : undefined}
                  onClick={syncYearAmounts}
                >
                  {syncBusy ? "מסנכרנים..." : `סנכרון סכומי ${year}`}
                </button>
                <Link className="tools-menu__item" to="/investors">הכנת הסכם למסלול חדש</Link>
              </div>
            </details>
          ) : null}
        </div>
      </header>
      </ScrollReveal>

      <ScrollReveal className="filters">
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
            <option value="skipped">דולג / בוטל</option>
          </select>
        </label>
        <label className="payment-history-toggle">
          <input className="payment-history-toggle__input" type="checkbox" role="switch"
            checked={showCancellationHistory || allYears || status === "skipped"}
            disabled={allYears || status === "skipped"}
            onChange={(e) => setShowCancellationHistory(e.target.checked)} />
          <span className="payment-history-toggle__track" aria-hidden="true" />
          <span className="payment-history-toggle__label">הצגת היסטוריית ביטולים</span>
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
              {(investors ?? [])
                .filter((i) => !isAdminShellInvestor(i))
                .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </ScrollReveal>

      <section className="payment-current-summary" aria-label={`סיכום תשלומי ${year}`}>
        <p className="payment-current-summary__scope">סיכום {year}{selectedInvestorName ? ` · ${selectedInvestorName}` : ""}{allYears ? " · הרשימה מציגה את כל השנים" : ""}</p>
        <div className="payment-current-summary__grid">
          <Stat label={isManager ? "שולם למשקיעים בפועל" : "שולם לך בפועל"}
            value={formatMoney(yearly?.paid_investor ?? 0, true)}
            hint={`${yearly?.paid_count ?? 0} תשלומים ששולמו`}
            active={detailFocus === "yearly-paid"} onClick={() => openDetail("yearly-paid")} />
          <Stat label="ממתינים לאישור" value={String(yearly?.awaiting_count ?? 0)}
            active={detailFocus === "yearly-awaiting"} onClick={() => openDetail("yearly-awaiting")} />
          <Stat label="תשלומים מתוכננים" value={String(yearly?.scheduled_count ?? 0)}
            active={detailFocus === "yearly-scheduled"} onClick={() => openDetail("yearly-scheduled")} />
          <Stat label="תכנון לשנה · כולל מה ששולם" value={formatMoney(yearly?.planned_investor ?? 0, true)}
            active={detailFocus === "yearly-planned"} onClick={() => openDetail("yearly-planned")} />
        </div>
      </section>

      {(focusPaymentId || focusMonth) && !detailFocus ? (
        <div className="detail-focus-banner" role="status">
          <div>
            <strong>טיפול בהעברה</strong>
            <span className="muted">
              {selectedInvestorName ? ` · ${selectedInvestorName}` : ""}
              {focusMonth ? ` · ${formatCalendarMonth(`${focusMonth}-01`)}` : ""}
            </span>
          </div>
        </div>
      ) : null}

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

      {!isManager ? (
        <ScrollReveal>
        <PaymentCeremonyCard
          payments={payments.filter((p) => p.status === "awaiting_confirmation")}
          busyId={markBusyId}
          onReceived={(id) => void confirmPayment(id)}
          onNotYet={(id) => void rejectPayment(id)}
        />
        </ScrollReveal>
      ) : null}

      <div
        ref={paymentsPanelRef}
        id="payments-list"
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
        action={
          isManager && !allYears && (yearly?.scheduled_count ?? 0) > 0 ? (
            <button
              type="button"
              className="btn btn--small hide-on-phone"
              disabled={markBusy || frozenYearBatch}
              title={frozenYearBatch ? "ממתין לחתימת הסכם עדכון מועדים; ניתן לשלוח תשלומים אחרים בנפרד" : undefined}
              onClick={markEntireYearPaid}
            >
              {markBusy ? "שולחים..." : "שלח בקשת אישור לכל השנה"}
            </button>
          ) : null
        }
      >
        {frozenYearBatch && isManager && !allYears ? <p className="hint" role="status">שליחה לכל השנה ממתינה לחתימה או לביטול הסכם עדכון מועדים. ניתן לשלוח בנפרד תשלומים ממסלולים אחרים.</p> : null}
        {displayedRows.length === 0 ? (
          <div className="empty-block">
            <p className="empty">
              {detailFocus
                ? `אין רשומות לפירוט «${DETAIL_LABELS[detailFocus]}».`
                : allYears
                  ? "אין רשומות לכל השנים עם הסינון הנוכחי."
                  : `אין רשומות לשנת ${year}. `}
              {!detailFocus && !allYears && isManager
                ? "מסלולים חדשים מופיעים בלוח רק לאחר חתימת המשקיע. אפשר להכין הסכם בעמוד המשקיעים."
                : !detailFocus && !allYears
                  ? "פנו למנהל לבירור המסלולים והמסמכים לשנה זו."
                  : null}
            </p>
            {isManager && !allYears && !detailFocus ? (
              <Link className="btn btn--admin" to="/investors">להסכמים ולמסלולים</Link>
            ) : null}
          </div>
        ) : (
          <>
          <div className="table-wrap table-wrap--desktop">
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
                {displayedRows.map((row) => {
                  if (row.kind === "closure") return (
                  <tr key={`closure-${row.plan.id}`} className="payment-row" data-payment-month={row.date.slice(0, 7)} data-investor-id={row.plan.investor_id}>
                    {isManager ? <td>{row.plan.investor_name}</td> : null}
                    {allYears ? <td>{row.date.slice(0, 4)}</td> : null}
                    <td>{formatCalendarMonth(row.date)}</td><td>{formatDate(row.date)}</td>
                    <td>—</td>{isManager ? <td>—</td> : null}
                    <td><strong>סיום מסלול #{row.plan.id}</strong></td><td />
                  </tr>
                  );
                  const p = row.payment;
                  return (
                  <tr
                    key={p.id}
                    className="payment-row"
                    data-payment-id={p.id}
                    data-payment-month={p.due_date.slice(0, 7)}
                    data-investor-id={p.investor_id}
                  >
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
                      <span className={`badge badge--${p.status}`}>{paymentDisplayStatus(p)}</span>
                      {p.date_amendment_pending ? <p className="hint">ממתין לחתימת הסכם עדכון מועדים</p> : null}
                    </td>
                    <td className="table__actions">{paymentRowActions(p)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="pay-cards">
            {displayedRows.map((row) => {
              if (row.kind === "closure") return (
              <li key={`closure-card-${row.plan.id}`} className="pay-card" data-payment-month={row.date.slice(0, 7)} data-investor-id={row.plan.investor_id}>
                <div className="pay-card__top"><div><strong className="pay-card__title">סיום מסלול #{row.plan.id}</strong>
                  <span className="muted">{isManager ? `${row.plan.investor_name} · ` : ""}{formatCalendarMonth(row.date)} · {formatDate(row.date)}</span>
                </div></div>
                <p className="hint">המסלול נסגר בתאריך זה. תשלומים שבוטלו נשמרים בהיסטוריית הביטולים.</p>
              </li>
              );
              const p = row.payment;
              return (
              <li
                key={`card-${p.id}`}
                className={`pay-card pay-card--${p.status}`}
                data-payment-id={p.id}
                data-payment-month={p.due_date.slice(0, 7)}
                data-investor-id={p.investor_id}
              >
                <div className="pay-card__top">
                  <div>
                    <strong className="pay-card__title">
                      {isManager ? p.investor_name : formatCalendarMonth(p.due_date)}
                    </strong>
                    <span className="muted">
                      {isManager
                        ? `${formatCalendarMonth(p.due_date)}${allYears ? ` · ${p.due_date.slice(0, 4)}` : ""} · ${formatDate(p.due_date)}`
                        : formatDate(p.due_date)}
                    </span>
                  </div>
                  <span className={`badge badge--${p.status}`}>{paymentDisplayStatus(p)}</span>
                </div>
                <div className="pay-card__amount">
                  <span>{isManager ? "סכום למשקיע" : "הסכום שלך"}</span>
                  <strong>{formatMoney(p.investor_amount, true)}</strong>
                  {isManager ? <em>עמלה {formatMoney(p.manager_amount, true)}</em> : null}
                </div>
                {p.date_amendment_pending ? <p className="hint">התשלום ממתין לחתימת הסכם עדכון מועדי המסלול. הפעולות ייפתחו לאחר חתימה או ביטול ההסכם.</p> : null}
                <div className="pay-card__actions">{paymentRowActions(p)}</div>
              </li>
              );
            })}
          </ul>
          </>
        )}
      </Panel>
      </div>

      <div className="payment-secondary" aria-label="חיסכון, סיכומים והיסטוריה">
      {isManager && yearInvestors.length > 0 ? (
        <details className="payment-disclosure">
          <summary><span>משקיעים בלוח {year}</span><span className="payment-disclosure__hint">{yearInvestors.length} משקיעים · ניהול הלוח</span></summary>
        <Panel
          title={`מי בלוח ${year}`}
          action={
            <button
              type="button"
              className={manageYear ? "btn btn--small btn--ghost btn--danger" : "btn btn--small btn--ghost"}
              onClick={() => setManageYear((v) => !v)}
            >
              {manageYear ? "סיום עריכה" : "עריכת לוח"}
            </button>
          }
        >
          <ul className="list">
            {yearInvestors.map((inv) => {
              const savings = savingsByInvestor.get(inv.id) ?? [];
              const track = primaryPlanForInvestor(plans, inv.id, year);
              const end = track ? planTrackEnd(track) : null;
              const selected = investorId === String(inv.id);
              return (
                <li key={inv.id} className={selected ? "list__row list__row--selected" : "list__row"}>
                  <button
                    type="button"
                    className="list__pick"
                    onClick={() => {
                      setInvestorId((cur) => (cur === String(inv.id) ? "" : String(inv.id)));
                      setDetailFocus(null);
                    }}
                  >
                    <strong>
                      {inv.name}
                      {selected ? <span className="chip">נבחר</span> : null}
                    </strong>
                    {track ? (
                      <span className="muted">
                        {formatCalendarMonth(track.start_date)} {track.start_date.slice(0, 4)}
                        {" → "}
                        {formatCalendarMonth(end)} {end?.slice(0, 4)}
                        {" · "}
                        {track.duration_months} ח׳
                      </span>
                    ) : (
                      <span className="muted">מופיע בדוח {year}</span>
                    )}
                    {savings.length > 0 ? (
                      <span className="muted">
                        חיסכון {formatMoney(savings[0].current_savings_balance ?? 0)}
                      </span>
                    ) : null}
                  </button>
                  {manageYear ? (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--danger"
                      disabled={removeBusyId === inv.id}
                      onClick={() => removeInvestorFromYear(inv)}
                    >
                      {removeBusyId === inv.id ? "מסירים..." : "הסר מהשנה"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
        </details>
      ) : null}

      {activeSavingsPlans.length > 0 ? (
        <details ref={savingsDisclosureRef} className="payment-disclosure">
          <summary><span>חיסכון פעיל</span><span className="payment-disclosure__hint">נצבר {formatMoney(savingsTotals.savingsToDate, true)} · פירוט ותחזית</span></summary>
        <div
          ref={savingsPanelRef}
          className={[
            detailFocus === "lifetime-savings-now" ||
            detailFocus === "lifetime-savings-end"
              ? "detail-target detail-target--active"
              : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined}
        >
          <Panel
            title={
              detailFocus === "lifetime-savings-now"
                ? "פירוט · חיסכון עד עכשיו"
                : detailFocus === "lifetime-savings-end"
                  ? "פירוט · חיסכון עד סוף מסלול"
                  : "חיסכון פעיל · לפי תנאי מסלול"
            }
          >
            {savingsByInvestorCards.length > 1 ? (
              <div className="savings-grand-total">
                <span className="muted">סה״כ כל המשקיעים בלוח</span>
                <div className="savings-grand-total__nums">
                  <strong>חיסכון שנצבר עד עכשיו {formatMoney(savingsTotals.savingsToDate)}</strong>
                </div>
              </div>
            ) : null}

            <div className="savings-investor-list">
              {savingsByInvestorCards.map((inv) => (
                <article key={inv.id} className="savings-investor-card">
                  <header className="savings-investor-card__head">
                    <div>
                      <h3 className="savings-investor-card__name">{inv.name}</h3>
                      <p className="muted" style={{ margin: 0 }}>
                        {inv.plans.length === 1
                          ? `${planTypeLabel(inv.plans[0].plan_type)} · קרן ${formatMoney(inv.plans[0].principal)}`
                          : `${inv.plans.length} מסלולי חיסכון / משולב`}
                      </p>
                    </div>
                    <div className="savings-investor-card__hero">
                      <span className="stat__label">יתרת חיסכון שנצברה</span>
                      <strong className="savings-investor-card__hero-value">
                        {formatMoney(inv.savingsToDate)}
                      </strong>
                      <span className="muted">
                        חיסכון בלבד · ללא תשלומי המזומן
                      </span>
                    </div>
                  </header>

                  <div className="savings-breakdown">
                    <div className="savings-breakdown__item">
                      <span className="stat__label">צבירת חיסכון חודשית</span>
                      <strong>{formatMoney(inv.plans.reduce((sum, p) => sum + Number(p.monthly_savings_accrual || 0), 0))}</strong>
                    </div>
                    <div className="savings-breakdown__plus" aria-hidden>
                      ·
                    </div>
                    <div className="savings-breakdown__item">
                      <span className="stat__label">חיסכון עד עכשיו</span>
                      <strong>{formatMoney(inv.savingsToDate)}</strong>
                    </div>
                    <div className="savings-breakdown__plus" aria-hidden>
                      ·
                    </div>
                    <div className="savings-breakdown__item savings-breakdown__item--total">
                      <span className="stat__label">צבירת חיסכון חדשה במסלולים המוצגים</span>
                      <strong>{formatMoney(inv.plans.reduce((sum, p) => sum + Number(p.accrued_savings_balance ?? p.current_savings_balance ?? 0), 0))}</strong>
                    </div>
                    <div className="savings-breakdown__item savings-breakdown__item--end">
                      <span className="stat__label">חיסכון צפוי בסיום מסלול</span>
                      <strong>{formatMoney(inv.savingsAtEnd)}</strong>
                    </div>
                  </div>

                  {inv.plans.map((p) => {
                    const cash = planCashToDate(p);
                    const sav = Number(p.current_savings_balance || 0);
                    const progress =
                      p.duration_months > 0
                        ? Math.min(
                            100,
                            Math.round(
                              (Number(p.months_elapsed || 0) /
                                p.duration_months) *
                                100,
                            ),
                          )
                        : 0;
                    return (
                      <div key={p.id} className="savings-track-block">
                        <div className="savings-track-block__meta">
                          <div>
                            <strong>
                              מסלול #{p.id} · {planTypeLabel(p.plan_type)}
                              {p.status === "active" ? " · פעיל" : " · הסתיים"}
                            </strong>
                            <div className="muted">
                              {formatCalendarMonth(p.start_date)}{" "}
                              {p.start_date.slice(0, 4)}
                              {" → "}
                              {formatCalendarMonth(planTrackEnd(p))}{" "}
                              {planTrackEnd(p).slice(0, 4)}
                              {" · "}
                              {p.months_elapsed}/{p.duration_months} חודשים
                              {p.status !== "active"
                                ? " · חיסכון חודשי בזמנו (לא נוסף על הפעיל)"
                                : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => focusStatusReport(p.id)}
                          >
                            פירוט חודשי
                          </button>
                        </div>

                        <div
                          className="savings-progress"
                          title={`${progress}% מהמסלול`}
                        >
                          <div
                            className="savings-progress__bar"
                            style={{ width: `${progress}%` }}
                          />
                        </div>

                        <div className="savings-track-nums">
                          <div>
                            <span className="stat__label">קרן</span>
                            <strong>{formatMoney(p.principal)}</strong>
                          </div>
                          <div>
                            <span className="stat__label">מזומן עד עכשיו</span>
                            <strong>{formatMoney(cash)}</strong>
                            {p.plan_type !== "savings" ? (
                              <span className="muted">
                                {formatMoney(p.monthly_investor_payout, true)} ×{" "}
                                {p.months_elapsed || p.paid_count || 0} ח׳
                              </span>
                            ) : (
                              <span className="muted">אין מזומן חודשי</span>
                            )}
                          </div>
                          <div>
                            <span className="stat__label">חיסכון עד עכשיו</span>
                            <strong>{formatMoney(sav)}</strong>
                            <span className="muted">
                              {formatMoney(p.monthly_savings_accrual, true)}/ח׳ ·{" "}
                              {formatPercent(p.savings_rate_percent)}
                            </span>
                          </div>
                          <div className="savings-track-nums__total">
                            <span className="stat__label">צבירת חיסכון במסלול עד היום</span>
                            <strong>{formatMoney(Number(p.accrued_savings_balance ?? sav))}</strong>
                            <span className="muted">לפני משיכות חיסכון קודמות</span>
                          </div>
                          <div>
                            <span className="stat__label">חיסכון צפוי בסיום</span>
                            <strong>
                              {formatMoney(p.projected_savings_balance)}
                            </strong>
                            <span className="muted">
                              מחושב על הקרן בלבד
                            </span>
                          </div>
                        </div>

                        <Link className="btn btn--small btn--ghost" to={`/investors?investor_id=${p.investor_id}&plan_id=${p.id}`}>לניהול מסלול #{p.id}</Link>
                      </div>
                    );
                  })}
                </article>
              ))}
            </div>
          </Panel>
        </div>
        </details>
      ) : null}

      {closedSavingsPlans.length > 0 ? (
        <details className="payment-disclosure">
          <summary><span>היסטוריית חיסכון</span><span className="payment-disclosure__hint">{closedSavingsPlans.length} מסלולים סגורים</span></summary>
        <Panel
          title="תיקי חיסכון סגורים"
        >
          <div className="closed-plans">
            {closedSavingsPlans.map((p) => (
              <div key={p.id} className="closed-plan-row">
                <div>
                  <strong>
                    {p.investor_name} · מסלול #{p.id} · {planTypeLabel(p.plan_type)} · סגור
                  </strong>
                  <span className="muted">
                    קרן {formatMoney(p.principal)} · מזומן עד אז{" "}
                    {formatMoney(planCashToDate(p))} · חיסכון שנותר{" "}
                    {formatMoney(Number(p.current_savings_balance || 0))}
                    {p.successor_plan_id
                      ? ` · המשך במסלול #${p.successor_plan_id}`
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => focusStatusReport(p.id)}
                >
                  פירוט חודשי
                </button>
              </div>
            ))}
          </div>
        </Panel>
        </details>
      ) : null}

      {statusReportPlans.length > 0 ? (
        <details ref={reportsDisclosureRef} className="payment-disclosure">
          <summary><span>דוחות חודשיים לפי מסלול</span><span className="payment-disclosure__hint">תשלומים וחיסכון · מתחילת המסלול</span></summary>
          <div className="payment-disclosure__body">
            {statusReportPlans.map((p) => (
              <details key={p.id} id={`status-report-plan-${p.id}`} className="payment-plan-report">
                <summary>
                  <span>{isManager ? `${p.investor_name} · ` : ""}מסלול #{p.id} · {planTypeLabel(p.plan_type)}</span>
                  <span className="payment-disclosure__hint">
                    {formatDate(p.start_date)} → {p.closed_on ? `סיום בפועל ${formatDate(p.closed_on)}` : `סיום מתוכנן ${formatDate(planTrackEnd(p))}`}
                    {isClosedPaymentPlan(p) ? " · היסטוריה" : " · פעיל"}
                  </span>
                </summary>
                <PlanStatusReportPanel planId={p.id} />
              </details>
            ))}
          </div>
        </details>
      ) : null}

      <details className="payment-disclosure">
        <summary><span>סיכומים נוספים</span><span className="payment-disclosure__hint">כל השנים, חיסכון ותחזית{isManager ? " · רווחי מנהל" : ""}</span></summary>
        <div className="payment-disclosure__body">
          {isManager ? <Panel title={`רווחי מנהל · ${year}`}>
            <Stat label="עמלות ששולמו בפועל" value={formatMoney(yearly?.paid_manager ?? 0, true)} tone="manager"
              active={detailFocus === "yearly-fees"} onClick={() => openDetail("yearly-fees")} />
          </Panel> : null}
        <Panel
          title="סיכום כל השנים"
        >
          <div className="stats-grid stats-grid--compact">
            <Stat
              label={isManager ? "סה״כ שולם למשקיעים" : "סה״כ שולם לי"}
              value={formatMoney(lifetime?.paid_investor ?? 0)}
              active={detailFocus === "lifetime-paid"}
              onClick={() => openDetail("lifetime-paid")}
            />
            <Stat
              label="תכנון לכל השנים · כולל תשלומים ששולמו"
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
              label="חיסכון צפוי בסיום המסלולים"
              value={formatMoney(lifetime?.savings_to_track_end ?? 0)}
              active={detailFocus === "lifetime-savings-end"}
              onClick={() => openDetail("lifetime-savings-end")}
            />
          </div>
        </Panel>

        </div>
      </details>
      </div>
    </div>
  );
}
