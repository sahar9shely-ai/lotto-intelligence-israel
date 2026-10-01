import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DocumentsPage } from "./DocumentsPage";
import { Panel } from "../components/Panel";
import { AvailableBalancePanel } from "../components/AvailableBalancePanel";
import { AgreementPanel, AgreementShare, AgreementContent, NoticePanel } from "../components/AgreementPanel";
import type { PlanAgreement } from "../types/investments";
import { RevealSecret } from "../components/RevealSecret";
import { disableIdentityAutofill, PasswordField } from "../components/PasswordField";
import { PlanStatusReportPanel } from "../components/PlanStatusReportPanel";
import { PlanTrackFields } from "../components/PlanTrackFields";
import { SavingsActions } from "../components/SavingsActions";
import { PlanCoolingOffBanner, TopupRequestsPanel } from "../components/TopupRequestsPanel";
import { ScrollReveal } from "../components/motion/ScrollReveal";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Investor, Plan, Settings } from "../types/investments";
import { addMonthsISO, formatDate, formatMoney, formatPercent, todayISO, yearStartISO } from "../utils/format";
import { planTypeLabel } from "../utils/planTypes";
import { isAdminShellInvestor } from "../utils/roles";
import {
  copyAccessWhatsAppMessage,
  formatPhoneDisplay,
  whatsAppAccessUrl,
} from "../utils/whatsapp";

type Scope = "all" | number;
type TrackView = "active" | "closed";
type WorkspaceSection = "plans" | "balance" | "documents" | "requests";
const WORKSPACE_SECTIONS: {id: WorkspaceSection; title: string; hint: string}[] = [
  {id:"plans",title:"מסלולים",hint:"ניהול מסלולים פעילים וסגורים. סיום מסלול מתחיל בכרטיס המסלול ומתבצע רק לאחר חתימה."},
  {id:"balance",title:"יתרה זמינה",hint:"כסף שהשתחרר ממסלולים סגורים, משיכות והיסטוריית תנועות."},
  {id:"documents",title:"מסמכים וחתימות",hint:"מסמכים הממתינים לחתימה, הסכמים קודמים ודוחות המשקיע."},
  {id:"requests",title:"בקשות",hint:"טיפול בבקשות המשקיע. הודעה חודש מראש נדרשת למשיכת כספים בתום המסלול בלבד."},
];

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
  const canClosePlans = isManager && user?.username === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: investors, error, loading, reload, setData: setInvestors } = useAsync(() => api.investors(), []);
  const { data: settings } = useAsync(
    () => (isManager ? api.settings() : Promise.resolve(null)),
    [isManager],
  );
  const { data: siteStatus } = useAsync(
    () => (isManager ? api.siteStatus() : Promise.resolve(null)),
    [isManager],
  );
  const { data: plans, reload: reloadPlans } = useAsync(() => api.plans(), []);
  const { data: topupRequests, reload: reloadTopups } = useAsync(
    () => api.topupRequests(),
    [],
  );
  const [scope, setScope] = useState<Scope | null>(null);
  const sectionParam = searchParams.get("section");
  const workspaceSection: WorkspaceSection = WORKSPACE_SECTIONS.some(s => s.id === sectionParam) ? sectionParam as WorkspaceSection : "plans";
  const [agreementRevision, setAgreementRevision] = useState(0);
  function goToSection(section: WorkspaceSection) {
    setSearchParams(previous => {const next = new URLSearchParams(previous); next.set("section",section); next.delete("action"); next.delete("plan_id"); return next;}, {replace:true});
  }
  function selectInvestor(id: Scope, section?: WorkspaceSection) {
    setScope(id); setTrackView("active"); setEditingPlanId(null); setReportPlanId(null);
    setShowTopupCreate(false); setIssuedAgreement(null);
    setSearchParams(previous => {const next = new URLSearchParams(previous); next.delete("plan_id"); next.delete("action"); if(section) next.set("section",section); if(id === "all") next.delete("investor_id"); else next.set("investor_id",String(id)); return next;}, {replace:true});
  }
  const [trackView, setTrackView] = useState<TrackView>("active");
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);
  const [reportPlanId, setReportPlanId] = useState<number | null>(null);
  const [showNewInvestor, setShowNewInvestor] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [issuedAgreement, setIssuedAgreement] = useState<PlanAgreement | null>(null);
  const [showTopupCreate, setShowTopupCreate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);

  useEffect(() => {
    if (searchParams.get("action") === "topup" && !isManager) {
      setShowTopupCreate(true);
      goToSection("requests");
    }
  }, [searchParams, isManager]);

  const refreshAll = useCallback(() => {
    reload();
    reloadPlans();
    reloadTopups();
    setAgreementRevision(v => v + 1);
  }, [reload, reloadPlans, reloadTopups]);

  const publicUrl = siteStatus?.public_url || window.location.origin;

  function accessMissing(inv: Investor): boolean {
    return !inv.phone || !inv.access_username || !inv.access_password;
  }

  async function copyInvestorAccess(inv: Investor) {
    if (accessMissing(inv)) {
      setMessage("חסר טלפון, שם משתמש או סיסמה כדי לשלוח פרטי התחברות");
      return;
    }
    try {
      await copyAccessWhatsAppMessage(inv, publicUrl);
      setMessage(`הטקסט עם הקישור והכניסה הועתק עבור ${inv.name}`);
    } catch {
      setMessage("לא ניתן להעתיק את פרטי ההתחברות");
    }
  }

  function openInvestorWhatsApp(inv: Investor) {
    if (accessMissing(inv)) {
      setMessage("חסר טלפון, שם משתמש או סיסמה כדי לפתוח הודעת התחברות");
      return;
    }
    const url = whatsAppAccessUrl(inv, publicUrl);
    if (!url) {
      setMessage("לא ניתן לפתוח וואטסאפ — בדקו את מספר הטלפון");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setMessage(`נפתחה הודעת התחברות מוכנה עבור ${inv.name}`);
  }

  const bookInvestors = useMemo(
    () => (investors ?? []).filter((inv) => !isAdminShellInvestor(inv)),
    [investors],
  );

  const effectiveScope: Scope = useMemo(() => {
    const linkedId = Number(searchParams.get("investor_id"));
    if (linkedId && bookInvestors.some(i => i.id === linkedId)) return linkedId;
    if (scope != null) return scope;
    if (!isManager && bookInvestors[0]) return bookInvestors[0].id;
    return "all";
  }, [scope, isManager, bookInvestors, searchParams]);

  const selected = useMemo(() => {
    if (!bookInvestors.length) return null;
    if (effectiveScope === "all") return null;
    return bookInvestors.find((i) => i.id === effectiveScope) ?? null;
  }, [bookInvestors, effectiveScope]);

  const {data: agreementData, loading: agreementsLoading, refreshing: agreementsRefreshing, error: agreementsError} = useAsync(
    () => selected ? api.agreements(selected.id) : Promise.resolve([]), [selected?.id, agreementRevision],
  );
  const selectedAgreements = (agreementData ?? []).filter(row => row.investor_id === selected?.id);
  const pendingAgreements = selectedAgreements.filter(row => row.status === "pending");
  const selectedRequests = (topupRequests ?? []).filter(row => row.investor_id === selected?.id);
  const pendingRequests = selectedRequests.filter(row => row.status === "pending" || row.status === "contract");
  function openAgreement(row: PlanAgreement) {setIssuedAgreement(row); goToSection("documents");}
  function agreementPrepared(row: PlanAgreement) {openAgreement(row); refreshAll();}

  useEffect(() => {
    const planId = Number(searchParams.get("plan_id"));
    const plan = (plans ?? []).find(p => p.id === planId && p.investor_id === selected?.id);
    if (!plan || workspaceSection !== "plans") return;
    setTrackView(plan.status === "completed" ? "closed" : "active");
    const timer = window.setTimeout(() => document.getElementById(`plan-${planId}`)?.scrollIntoView({behavior:"smooth",block:"center"}), 150);
    return () => window.clearTimeout(timer);
  }, [searchParams, plans, selected?.id, workspaceSection]);

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
    const list = bookInvestors;
    return {
      principal: list.reduce((s, i) => s + (i.active_principal || 0), 0),
      cash: list.reduce((s, i) => s + cashOf(i), 0),
      savings: list.reduce((s, i) => s + savingsOf(i), 0),
      savingsBalance: list.reduce((s, i) => s + (i.current_savings_balance || 0), 0),
    };
  }, [bookInvestors]);

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
    setInvestors(previous => previous ? [...previous, created] : [created]);
    setShowNewInvestor(false);
    selectInvestor(created.id, "plans");
    setShowNewPlan(true);
    setMessage("משקיע חדש נוסף עם שם משתמש וסיסמה");
    reload();
  }

  async function onCreatePlan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    const notice = await api.createNotice(selected.id, {purpose: "new", requested_on: String(fd.get("notice_requested_on"))});
    const agreement = await api.openAgreement({
      notice_id: notice.id,
      investor_id: selected.id,
      principal: Number(fd.get("principal") || 0),
      additional_funds: Number(fd.get("additional_funds") || 0),
      operation_key: String(fd.get("operation_key")),
      plan_type: String(fd.get("plan_type") || "monthly"),
      monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
      savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
      manager_fee_percent: Number(fd.get("manager_fee_percent") || 0),
      manager_savings_rate_percent: Number(fd.get("manager_savings_rate_percent") || 0),
      start_date: String(fd.get("start_date") || yearStartISO()),
      duration_months: Number(fd.get("duration_months") || 12),
      notes: String(fd.get("notes") || "") || undefined,
      generate_schedule: true,
    });
    setShowNewPlan(false);
    openAgreement(agreement);
    setMessage("הסכם המסלול הוכן. המסלול יופעל רק לאחר חתימת המשקיע");
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
      manager_savings_rate_percent: Number(fd.get("manager_savings_rate_percent") || 0),
      duration_months: Number(fd.get("duration_months") || 12),
      status: String(fd.get("status") || "active"),
      regenerate_schedule: true,
    };
    if (nextStart !== plan.start_date) {
      body.start_date = nextStart;
    }
    try {
      await api.updatePlan(plan.id, body);
      setEditingPlanId(null);
      setMessage("המסלול עודכן — מזומן וחיסכון סונכרנו בנפרד");
      refreshAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "עדכון המסלול נכשל");
    }
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

  if (loading) return <div className="state state--loading">טוען משקיעים...</div>;
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
      <ScrollReveal>
      <header className="page-intro">
        <div>
          <h1 className="page-intro__title">
            {isManager ? "תיקי משקיעים" : "תיק ההשקעה שלי"}
          </h1>
          {isManager ? (
            <p className="hint" id="new-plan-help">
              {selected
                ? `כל הפעולות והמסמכים של ${selected.name} מרוכזים בתיק אחד.`
                : "בחרו משקיע לפתיחת התיק: מסלולים, יתרה זמינה, מסמכים ובקשות."}
            </p>
          ) : null}
        </div>
        {isManager ? (
          <div className="page-head__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setShowNewInvestor(true)}>
              משקיע חדש
            </button>
          </div>
        ) : null}
      </header>
      </ScrollReveal>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}

      {isManager ? (
        <div className="scope-bar" role="tablist" aria-label="בחירת משקיע">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveScope === "all"}
            className={effectiveScope === "all" ? "scope-bar__btn is-active" : "scope-bar__btn"}
            onClick={() => {
              selectInvestor("all");
            }}
          >
            סה״כ כולם
          </button>
          {bookInvestors.map((inv) => (
            <button
              key={inv.id}
              type="button"
              role="tab"
              aria-selected={effectiveScope === inv.id}
              className={effectiveScope === inv.id ? "scope-bar__btn is-active" : "scope-bar__btn"}
              onClick={() => {
                selectInvestor(inv.id);
              }}
            >
              {inv.name}
              {inv.is_manager ? " · מנהל" : ""}{(topupRequests ?? []).some(r => r.investor_id === inv.id && (r.status === "pending" || r.status === "contract")) ? " · בקשה לטיפול" : ""}
            </button>
          ))}
        </div>
      ) : null}

      {effectiveScope === "all" && isManager && workspaceSection !== "plans" ? (
        <Panel title={WORKSPACE_SECTIONS.find(s => s.id === workspaceSection)?.title ?? "תיקי משקיעים"}>
          <p className="empty">בחרו משקיע מהרשימה למעלה כדי לפתוח את האזור הזה בתיק שלו.</p>
        </Panel>
      ) : effectiveScope === "all" && isManager ? (
        <ScrollReveal className="stack">
          <Panel
            title="סיכום כל המשקיעים"
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

          <Panel title="פירוט לפי משקיע">
            <div className="investor-table-wrap table-wrap--desktop">
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
                  {bookInvestors.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => selectInvestor(inv.id)}
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
            <ul className="investor-cards">
              {bookInvestors.map((inv) => (
                <li key={`card-${inv.id}`}>
                  <button
                    type="button"
                    className="investor-card"
                    onClick={() => selectInvestor(inv.id)}
                  >
                    <div className="investor-card__top">
                      <div>
                        <strong>
                          {inv.name}
                          {inv.is_manager ? " · מנהל" : ""}
                        </strong>
                        <span className="muted">
                          {(inv.plan_types ?? [])
                            .map((t) => planTypeLabel(t))
                            .join(" · ") || "אין מסלול פעיל"}
                        </span>
                      </div>
                      <span className="investor-card__cta">לכרטיס</span>
                    </div>
                    <div className="investor-card__hero">
                      <span>סה״כ חודשי</span>
                      <strong>{formatMoney(totalMonthlyOf(inv))}</strong>
                    </div>
                    <div className="investor-card__grid">
                      <div>
                        <span>קרן</span>
                        <strong>{formatMoney(inv.active_principal)}</strong>
                      </div>
                      <div>
                        <span>מזומן</span>
                        <strong>{formatMoney(cashOf(inv))}</strong>
                      </div>
                      <div>
                        <span>חיסכון חודשי</span>
                        <strong>{formatMoney(savingsOf(inv))}</strong>
                      </div>
                      <div>
                        <span>יתרת חיסכון</span>
                        <strong>{formatMoney(inv.current_savings_balance ?? 0)}</strong>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </ScrollReveal>
      ) : selected ? (
        <ScrollReveal className="stack">
          <Panel title={`תיק המשקיע · ${selected.name}`} className="investor-workspace-header" action={
            <div className="page-head__actions">
              <Link className="btn btn--ghost btn--small" to={`/payments?investor_id=${selected.id}`}>תשלומי המשקיע</Link>
              {isManager ? <button className="btn btn--primary" disabled={agreementsLoading || agreementsRefreshing || Boolean(agreementsError) || pendingAgreements.length > 0} onClick={() => setShowNewPlan(true)} title={pendingAgreements.length ? "יש להשלים או לבטל את ההסכם הממתין לפני הכנת מסלול חדש" : undefined}>מסלול חדש</button> : null}
            </div>
          }>
            <div className="investor-overview">
              <div className="investor-overview__item"><span>קרן במסלולים פעילים</span><strong>{formatMoney(selected.active_principal)}</strong></div>
              <div className="investor-overview__item investor-overview__item--accent"><span>חיסכון שנצבר כעת</span><strong>{formatMoney(selected.current_savings_balance ?? 0)}</strong><small>צבירה חודשית: {formatMoney(savingsOf(selected))}</small></div>
              <div className="investor-overview__item"><span>יתרה זמינה</span><strong>{formatMoney(selected.available_balance ?? 0)}</strong><small>למשיכה או למסלול הבא</small></div>
              <div className="investor-overview__item"><span>החזר מזומן חודשי</span><strong>{formatMoney(cashOf(selected))}</strong><small>משולם בנפרד מהחיסכון</small></div>
            </div>
            {isManager && selected.has_login ? <details className="workspace-contact"><summary>פרטי קשר וכניסה למשקיע</summary><div className="workspace-contact__body"><span>שם משתמש: <strong dir="ltr">{selected.access_username || "—"}</strong></span><RevealSecret value={selected.access_password}/><span>{selected.phone ? `וואטסאפ: ${formatPhoneDisplay(selected.phone)}` : "חסר מספר טלפון"}</span><button className="btn btn--ghost btn--small" onClick={() => void copyInvestorAccess(selected)}>העתקת פרטי כניסה</button><button className="btn btn--ghost btn--small" onClick={() => openInvestorWhatsApp(selected)}>הכנת הודעת כניסה בוואטסאפ</button></div></details> : null}
            {agreementsError ? <p role="alert">לא ניתן לטעון את מצב החתימות. {agreementsError} <button className="btn btn--ghost btn--small" onClick={refreshAll}>נסה שוב</button></p> : null}
            {pendingAgreements.length ? <div className="workspace-pending"><span>{pendingAgreements.length} הסכמים ממתינים לחתימת המשקיע. הפעולה הכספית טרם בוצעה.</span><button className="text-link" onClick={() => goToSection("documents")}>למסמכים ולחתימה</button></div> : null}
          </Panel>
          <nav className="investor-workspace-nav" aria-label="אזורי תיק המשקיע">
            {WORKSPACE_SECTIONS.map(section => <button key={section.id} type="button" className={workspaceSection === section.id ? "investor-workspace-nav__item is-active" : "investor-workspace-nav__item"} aria-pressed={workspaceSection === section.id} onClick={() => goToSection(section.id)}>{section.title}{section.id === "documents" && pendingAgreements.length ? <em>{pendingAgreements.length}</em> : section.id === "requests" && pendingRequests.length ? <em>{pendingRequests.length}</em> : null}</button>)}
          </nav>
          <p className="workspace-section-hint">{WORKSPACE_SECTIONS.find(s => s.id === workspaceSection)?.hint}</p>
          {workspaceSection === "balance" ? <AvailableBalancePanel key={`${selected.id}:${selected.available_balance}`} investorId={selected.id} canManage={isManager} onChanged={refreshAll}/> : null}
          {workspaceSection === "documents" ? <div className="stack" key={`documents:${selected.id}`}>
            <AgreementPanel rows={selectedAgreements} loading={agreementsLoading || agreementsRefreshing} error={agreementsError} canManage={isManager} canManageClosing={canClosePlans} phone={selected.phone} onChanged={refreshAll}/>
            <DocumentsPage key={`vault:${selected.id}:${agreementRevision}`} investorId={selected.id} embedded excludeAgreements/>
          </div> : null}
          {workspaceSection === "requests" ? <div className="stack" key={`requests:${selected.id}`}>
            <NoticePanel investorId={selected.id}/>
            {!isManager && !pendingRequests.length ? <button className="btn btn--primary" onClick={() => setShowTopupCreate(true)}>בקשה להוספת מסלול</button> : null}
            <TopupRequestsPanel
        onOpenDocuments={() => goToSection("documents")}
        isManager={isManager}
        investorId={effectiveScope === "all" ? null : selected?.id ?? null}
        settings={settings}
        requests={topupRequests ?? []}
        onChanged={refreshAll}
        onMessage={setMessage}
        createOpen={showTopupCreate}
        onCreateOpenChange={setShowTopupCreate}
        onFocusInvestor={(id) => {
          selectInvestor(id);
        }}
      />
            {isManager && !selectedRequests.length ? <Panel title="בקשות מסלול לטיפול"><p className="empty">אין בקשות מסלול הממתינות לטיפול.</p><p className="hint">מסמכים קודמים נשמרים בלשונית ״מסמכים וחתימות״.</p></Panel> : null}
          </div> : null}
          {workspaceSection === "plans" ? <>
          {selectedPlans.length === 0 ? (
            <Panel title="אין מסלול עדיין">
              <p className="empty">עדיין אין מסלול למשקיע הזה.</p>
              <p className="hint">אפשר להכין הסכם באמצעות ״מסלול חדש״ בראש התיק.</p>
            </Panel>
          ) : (
            <>
              <div className="track-view-switch" role="group" aria-label="הפרדת מסלולים">
                <button
                  type="button"
                  aria-pressed={trackView === "active"}
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
                  aria-pressed={trackView === "closed"}
                  className={
                    trackView === "closed"
                      ? "track-view-switch__btn is-active"
                      : "track-view-switch__btn"
                  }
                  onClick={() => setTrackView("closed")}
                >
                  מסלולים סגורים
                  <em>{closedSelectedPlans.length}</em>
                </button>
              </div>

              {trackView === "active" ? (
                activeSelectedPlans.length > 0 || otherSelectedPlans.length > 0 ? (
                  <div className="stack track-section track-section--active">
                    <p className="track-section__label">מסלולים פעילים בלבד</p>
                    {[...activeSelectedPlans, ...otherSelectedPlans].map((plan) => (
                      <PlanCard
                        key={`${selected.id}:${plan.id}`}
                        plan={plan}
                        isManager={isManager}
                        canClosePlans={canClosePlans}
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
                        onAgreementPrepared={agreementPrepared}
                        onFinancialChanged={refreshAll}
                        onOpenAgreement={openAgreement}
                        pendingAgreement={pendingAgreements.find(row => row.kind === "close" && row.plan_id === plan.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <Panel
                    title="אין מסלול פעיל"
                  >
                    <p className="empty">אין מסלול פעיל למשקיע הזה כרגע.</p>
                    {closedSelectedPlans.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => setTrackView("closed")}
                      >
                        מעבר למסלולים סגורים ({closedSelectedPlans.length})
                      </button>
                    ) : null}
                    <p className="hint">אפשר להכין הסכם באמצעות ״מסלול חדש״ בראש התיק.</p>
                  </Panel>
                )
              ) : closedSelectedPlans.length > 0 ? (
                <Panel
                  title="מסלולים סגורים"
                >
                  <div className="closed-plans">
                    {closedSelectedPlans.map((plan) => (
                      <div key={plan.id} id={`plan-${plan.id}`} className="closed-plan-row">
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
                          {plan.closed_on ? <span className="muted" style={{display: "block"}}>נסגר ב-{plan.closed_on} · הועברו ליתרה הזמינה: קרן {formatMoney(plan.closing_principal ?? 0)} + חיסכון {formatMoney(plan.closing_savings ?? 0)}</span> : null}
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
                <Panel title="אין מסלולים סגורים">
                  <p className="empty">אין מסלולים סגורים.</p>
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
          </> : null}
        </ScrollReveal>
      ) : (
        <p className="empty">בחרו משקיע מהרשימה למעלה.</p>
      )}

      {issuedAgreement ? <Modal title="מסמך וקישור לחתימת המשקיע" onClose={() => setIssuedAgreement(null)}><div className="modal__body"><AgreementContent row={issuedAgreement}/>{issuedAgreement.status === "pending" && isManager && (issuedAgreement.kind !== "close" || canClosePlans) ? <AgreementShare key={issuedAgreement.id} row={issuedAgreement} phone={selected?.phone}/> : null}</div></Modal> : null}
      {showNewInvestor ? (
        <Modal title="משקיע חדש" onClose={() => setShowNewInvestor(false)}>
          <form className="form modal__form" autoComplete="off" onSubmit={onCreateInvestor}>
            <div className="modal__body">
              <label>
                שם
                <input name="name" required placeholder="שם המשקיע" autoComplete="off" />
              </label>
              <label>
                שם משתמש לגישה
                <input
                  name="username"
                  required
                  placeholder="revital"
                  dir="ltr"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  {...disableIdentityAutofill}
                />
              </label>
              <PasswordField
                label="סיסמה התחלתית"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
                enterKeyHint="done"
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
                <input name="phone" type="tel" inputMode="tel" placeholder="אופציונלי" autoComplete="tel" />
              </label>
              <label>
                מייל (אופציונלי)
                <input name="email" type="email" placeholder="אופציונלי" autoComplete="off" />
              </label>
              <label>
                הערות
                <textarea name="notes" rows={3} />
              </label>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setShowNewInvestor(false)}>
                ביטול
              </button>
              <button type="submit" className="btn btn--primary">
                הוסף
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {showNewPlan && planTarget ? (
        <Modal title={`מסלול חדש ל-${planTarget.name}`} onClose={() => setShowNewPlan(false)}>
          <PlanForm settings={settings} investor={planTarget} onSubmit={onCreatePlan} />
        </Modal>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  isManager,
  canClosePlans,
  editing,
  showReport,
  onToggleEdit,
  onToggleReport,
  onUpdate,
  onDelete,
  onAgreementPrepared,
  onFinancialChanged,
  onOpenAgreement,
  pendingAgreement,
  onMessage,
}: {
  plan: Plan;
  isManager: boolean;
  canClosePlans: boolean;
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
  onAgreementPrepared: (row: PlanAgreement) => void;
  onFinancialChanged: () => void;
  onOpenAgreement: (row: PlanAgreement) => void;
  pendingAgreement?: PlanAgreement;
  onMessage: (text: string) => void;
}) {
  const statusLabelHe =
    plan.status === "active" ? "פעיל" : plan.status === "paused" ? "מושהה" : "הסתיים";

  return (
    <Panel
      id={`plan-${plan.id}`}
      title={`${statusLabelHe} · ${planTypeLabel(plan.plan_type)} · מסלול #${plan.id}`}
      subtitle={`${formatDate(plan.start_date)}–${formatDate(addMonthsISO(plan.start_date, plan.duration_months))} · ${plan.duration_months} חודשים`}
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
          <SavingsActions plan={plan} canManage={canClosePlans} onPrepared={onAgreementPrepared} pendingAgreement={pendingAgreement} onOpenAgreement={onOpenAgreement} />
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
            <em>
              צפי {formatMoney(plan.projected_savings_balance)}
              {(plan.rollover_savings_balance ?? 0) > 0
                ? ` · כולל ${formatMoney(plan.rollover_savings_balance ?? 0)} מהמסלול הקודם`
                : ""}
            </em>
          </div>
        ) : null}
        {isManager ? (
          <div className="money-ledger__item">
            <span>עמלת ניהול {formatPercent(plan.manager_fee_percent ?? 0)}</span>
            <strong>{formatMoney(plan.monthly_manager_fee ?? 0, true)}</strong>
            <em>נוספת — לא מהמשקיע</em>
          </div>
        ) : null}
        {isManager ? <div className="money-ledger__item"><span>חיסכון מנהל {formatPercent(plan.manager_savings_rate_percent ?? 0)}</span><strong>{formatMoney(plan.monthly_manager_savings ?? 0)}</strong><em>/ חודש · נצבר {formatMoney(plan.accrued_manager_savings ?? 0)}</em></div> : null}
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
          onChanged={onFinancialChanged}
          onMessage={onMessage}
        />
      ) : null}

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
            <label>אחוז חיסכון מנהל<input name="manager_savings_rate_percent" type="number" min="0" step="0.01" defaultValue={plan.manager_savings_rate_percent ?? 0} /></label>
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

export function PlanForm({settings, investor, onSubmit}: {
  settings: Settings | null; investor: Investor;
  onSubmit: (e: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [additional, setAdditional] = useState("");
  const [cashRate, setCashRate] = useState(String(settings?.default_monthly_rate_percent ?? 0));
  const [savingsRate, setSavingsRate] = useState("0");
  const [managerCash, setManagerCash] = useState(String(settings?.default_manager_fee_percent ?? 0));
  const [managerSavings, setManagerSavings] = useState("0");
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{start: string; requested: string; duration: string; notes: string} | null>(null);
  const available = investor.available_balance ?? 0;
  const principal = Math.round((available + Number(additional || 0)) * 100) / 100;
  const cash = Number(cashRate || 0), savings = Number(savingsRate || 0);
  const type = cash > 0 && savings > 0 ? "hybrid" : savings > 0 ? "savings" : "monthly";
  const monthly = (rate: string) => Math.round(principal * Number(rate || 0)) / 100;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!review) {
      const values = new FormData(e.currentTarget);
      setReview({start: String(values.get("start_date")), requested: String(values.get("notice_requested_on")), duration: String(values.get("duration_months")), notes: String(values.get("notes") || "")});
      return;
    }
    setBusy(true); setError(null);
    try { await onSubmit(e); }
    catch (err) { setError(err instanceof Error ? err.message : "יצירת המסלול נכשלה"); }
    finally { setBusy(false); }
  }
  return <form className="form modal__form plan-opening" onSubmit={submit} onChange={() => setOperationKey(crypto.randomUUID())}>
    <div className="modal__body">
      <input type="hidden" name="operation_key" value={operationKey} />
      <input type="hidden" name="principal" value={principal} />
      <input type="hidden" name="plan_type" value={type} />
      <fieldset hidden={Boolean(review)} disabled={busy} className="plan-opening__section"><legend>1 · הקרן למסלול החדש</legend>
        <dl className="plan-opening-summary">
          <dt>קרן במסלולים פעילים</dt><dd>{formatMoney(investor.active_principal)}</dd>
          <dt>יתרה זמינה קיימת</dt><dd>{formatMoney(available)}</dd>
        </dl>
        <label>תוספת כסף חדש (₪)<input name="additional_funds" type="number" min="0" step="0.01" required value={additional} onChange={e => setAdditional(e.target.value)} placeholder="0 אם אין תוספת" /></label>
        <div className="plan-opening__total"><span>סך הקרן למסלול החדש</span><strong>{formatMoney(principal)}</strong></div>
        <p className="hint">כל היתרה הזמינה תיכנס למסלול. כדי להשקיע פחות, יש לבצע משיכה קודם. קרן במסלול פעיל תישאר בו עד לסגירתו.</p>
      </fieldset>
      <fieldset hidden={Boolean(review)} disabled={busy} className="plan-opening__section"><legend>2 · תנאי המשקיע</legend>
        <div className="form__grid">
          <label>אחוז החזר חודשי למשקיע<input name="monthly_rate_percent" type="number" min="0" step="0.01" required value={cashRate} onChange={e => setCashRate(e.target.value)} /><span className="hint">{formatMoney(monthly(cashRate))} במזומן לחודש</span></label>
          <label>אחוז חיסכון חודשי למשקיע<input name="savings_rate_percent" type="number" min="0" step="0.01" required value={savingsRate} onChange={e => setSavingsRate(e.target.value)} /><span className="hint">{formatMoney(monthly(savingsRate))} לחיסכון לחודש</span></label>
        </div>
        <p className="hint">החיסכון נצבר על הקרן בלבד, בחודשים מלאים, ללא ריבית דריבית. הזינו 0 לרכיב שאינו רלוונטי.</p>
      </fieldset>
      <fieldset hidden={Boolean(review)} disabled={busy} className="plan-opening__section plan-opening__section--manager"><legend>3 · רווח מנהל · גלוי למנהל בלבד</legend>
        <div className="form__grid">
          <label>אחוז מזומן חודשי למנהל<input name="manager_fee_percent" type="number" min="0" step="0.01" required value={managerCash} onChange={e => setManagerCash(e.target.value)} /><span className="hint">{formatMoney(monthly(managerCash))} במזומן לחודש</span></label>
          <label>אחוז חיסכון חודשי למנהל<input name="manager_savings_rate_percent" type="number" min="0" step="0.01" required value={managerSavings} onChange={e => setManagerSavings(e.target.value)} /><span className="hint">{formatMoney(monthly(managerSavings))} לחיסכון לחודש</span></label>
        </div>
        <p className="hint">רווחי המנהל מחושבים בנפרד, מעבר לתשואת המשקיע. חיסכון המנהל מתחיל ממועד פתיחת המסלול או מהיום, המאוחר מביניהם.</p>
      </fieldset>
      <fieldset disabled={busy} className="plan-opening__section"><legend>4 · תקופה וסיכום לפני שמירה</legend>
        <div className="form__grid" hidden={Boolean(review)}>
          <label>מועד קבלת הבקשה מהמשקיע<input name="notice_requested_on" type="date" max={new Date().toLocaleDateString("en-CA")} defaultValue={new Date().toLocaleDateString("en-CA")} required /></label>
          <p className="hint">יש לתעד את מועד קבלת הבקשה בפועל. המסלול ייפתח לאחר חתימה, ללא המתנה של חודש.</p>
          <label>תאריך התחלה מוצע<input name="start_date" type="date" defaultValue={todayISO()} required /></label>
          <label>משך בחודשים<input name="duration_months" type="number" min="1" max="120" defaultValue={settings?.default_duration_months ?? 12} required /></label>
          <label>הערות<input name="notes" placeholder="אופציונלי" /></label>
        </div>
        <dl className="plan-opening-summary">
          <dt>משקיע</dt><dd>{investor.name}</dd>
          <dt>קרן חדשה</dt><dd>{formatMoney(principal)}</dd>
          <dt>יתרה קיימת</dt><dd>{formatMoney(available)}</dd>
          <dt>תוספת כסף חדש</dt><dd>{formatMoney(Number(additional || 0))}</dd>
          <dt>מזומן למשקיע בחודש</dt><dd>{formatPercent(cash)} · {formatMoney(monthly(cashRate))}</dd>
          <dt>חיסכון למשקיע בחודש</dt><dd>{formatPercent(savings)} · {formatMoney(monthly(savingsRate))}</dd>
          <dt>מזומן למנהל בחודש</dt><dd>{formatPercent(Number(managerCash))} · {formatMoney(monthly(managerCash))}</dd>
          <dt>חיסכון למנהל בחודש</dt><dd>{formatPercent(Number(managerSavings))} · {formatMoney(monthly(managerSavings))}</dd>
          <dt>יתרה זמינה לאחר פתיחה</dt><dd>{formatMoney(0)}</dd>
        </dl>
        {review ? <p className="hint">בקשה התקבלה: {review.requested} · תאריך התחלה מוצע: {review.start} · משך: {review.duration} חודשים{review.notes ? ` · הערות: ${review.notes}` : ""}</p> : null}
      </fieldset>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div>
    <div className="modal__actions">{review ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setReview(null)}>חזרה לעריכה</button> : null}<button type="submit" className="btn btn--primary" disabled={busy || principal <= 0}>{busy ? "מכין הסכם..." : review ? "הכנת הסכם לחתימת המשקיע" : "בדיקת הנתונים לפני הכנת הסכם"}</button></div>
  </form>;
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
          <button type="button" className="modal__close" aria-label="סגירה" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
