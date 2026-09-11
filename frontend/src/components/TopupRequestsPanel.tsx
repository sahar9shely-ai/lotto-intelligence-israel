import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PlanTrackFields } from "./PlanTrackFields";
import { SignaturePad } from "./SignaturePad";
import { api } from "../services/api";
import type { Settings, TopupRequest } from "../types/investments";
import { formatDate, formatMoney, formatPercent, statusLabel, todayISO } from "../utils/format";
import { downloadContractPdf } from "../utils/contractPdf";
import { planTypeLabel } from "../utils/planTypes";

function isExecuted(status: string) {
  return status === "executed" || status === "approved";
}

function isOpen(status: string) {
  return status === "pending" || status === "contract";
}

function coolingCopy(req: TopupRequest): string {
  const until = req.cancel_until ? formatDate(req.cancel_until) : "";
  const days = req.cooling_off_days_left;
  if (!req.can_reverse_investment) return "";
  if (days <= 1) return `ניתן לבטל עד ${until} · עד סוף יום העסקים`;
  return `ניתן לבטל עד ${until} · נשארו ${days} ימי עסקים`;
}

function rateLine(req: TopupRequest): string {
  const type = req.plan_type || "monthly";
  if (type === "savings") return `${formatPercent(req.savings_rate_percent ?? 0)} חיסכון`;
  if (type === "hybrid") {
    return `${formatPercent(req.monthly_rate_percent ?? 0)} החזר + ${formatPercent(req.savings_rate_percent ?? 0)} חיסכון`;
  }
  return `${formatPercent(req.monthly_rate_percent ?? 0)} החזר חודשי`;
}

function stageIndex(req: TopupRequest): number {
  if (req.status === "rejected" || req.status === "cancelled" || req.status === "reversed") return -1;
  if (isExecuted(req.status)) return 3;
  if (req.status === "contract") return req.manager_signed || req.investor_signed ? 2 : 1;
  return 0;
}

const STAGES = ["בקשה", "חוזה", "חתימות", "ביצוע"];

function RequestModal({
  title,
  children,
  onClose,
  wide = false,
  kicker,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  kicker?: string;
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <button type="button" className="modal__backdrop" aria-label="סגירה" onClick={onClose} />
      <div className={wide ? "modal__sheet modal__sheet--wide contract-sheet" : "modal__sheet request-sheet"}>
        <header className="modal__head">
          <div>
            {kicker ? <p className="contract-kicker">{kicker}</p> : null}
            <h2>{title}</h2>
          </div>
          <button type="button" className="modal__close" aria-label="סגירה" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function CreateTrackForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (amount: number, notes: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState(false);
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed >= 1 && accepted;

  return (
    <form
      className="request-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit(parsed, notes.trim());
      }}
    >
      {error ? <p className="form-error">{error}</p> : null}
      <p className="request-form__lead">
        הבקשה תעבור למנהל. לאחר אישור התנאים יופק חוזה לחתימה דיגיטלית של שני הצדדים.
      </p>
      <label className="request-form__amount">
        <span>סכום הקרן למסלול החדש</span>
        <div className="money-input">
          <em>₪</em>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            required
            autoFocus
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {Number.isFinite(parsed) && parsed >= 1 ? (
          <strong className="request-form__preview">{formatMoney(parsed)}</strong>
        ) : (
          <span className="muted">הסכום שיתווסף כמסלול נפרד</span>
        )}
      </label>
      <label className="request-form__note">
        <span>הערה למנהל</span>
        <textarea
          rows={2}
          placeholder="אופציונלי"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <label className="request-form__legal">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>
          אני מבין שאין משיכת קרן עד סוף המסלול, וביטול אפשרי רק בתוך 3 ימי עסקים מיום ביצוע ההשקעה.
        </span>
      </label>
      <div className="request-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          ביטול
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || !valid}>
          {busy ? "שולח..." : "שליחת בקשה"}
        </button>
      </div>
    </form>
  );
}

function StageBar({ current }: { current: number }) {
  return (
    <ol className="track-stages" aria-label="שלבי הבקשה">
      {STAGES.map((label, index) => {
        const state = current < 0 ? "idle" : index < current ? "done" : index === current ? "current" : "idle";
        return (
          <li key={label} className={`track-stages__item is-${state}`}>
            <span>{index + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function SignBlock({
  title,
  signed,
  name,
  at,
  png,
  canSign,
  busy,
  error,
  defaultName,
  onSign,
}: {
  title: string;
  signed: boolean;
  name?: string | null;
  at?: string | null;
  png?: string | null;
  canSign: boolean;
  busy: boolean;
  error: string | null;
  defaultName: string;
  onSign: (typedName: string, png: string) => void;
}) {
  const [typedName, setTypedName] = useState(defaultName);
  const [signature, setSignature] = useState("");
  const [accepted, setAccepted] = useState(false);

  if (signed) {
    return (
      <div className="sign-card sign-card--done">
        <h3>{title}</h3>
        {png ? <img className="sign-card__img" src={png} alt="חתימה" /> : null}
        <strong>{name}</strong>
        <span className="muted">נחתם ב־{formatDate(at)}</span>
      </div>
    );
  }

  if (!canSign) {
    return (
      <div className="sign-card">
        <h3>{title}</h3>
        <p className="muted">ממתין לחתימה דיגיטלית</p>
      </div>
    );
  }

  return (
    <form
      className="sign-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!signature || !accepted || typedName.trim().length < 2) return;
        onSign(typedName.trim(), signature);
      }}
    >
      <h3>{title}</h3>
      {error ? <p className="form-error">{error}</p> : null}
      <label>
        שם מלא לחתימה
        <input value={typedName} onChange={(e) => setTypedName(e.target.value)} required minLength={2} />
      </label>
      <SignaturePad onChange={setSignature} disabled={busy} />
      <label className="request-form__legal">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>קראתי את תנאי החוזה ואני חותם עליהם דיגיטלית</span>
      </label>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={busy || !signature || !accepted || typedName.trim().length < 2}
      >
        {busy ? "חותם..." : "חתימה דיגיטלית"}
      </button>
    </form>
  );
}

export function TopupRequestsPanel({
  isManager,
  investorId,
  settings,
  requests,
  onChanged,
  onMessage,
  onFocusInvestor,
  createOpen = false,
  onCreateOpenChange,
}: {
  isManager: boolean;
  investorId?: number | null;
  settings: Settings | null;
  requests: TopupRequest[];
  onChanged: () => void;
  onMessage: (text: string) => void;
  onFocusInvestor?: (investorId: number) => void;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}) {
  const [internalCreate, setInternalCreate] = useState(false);
  const showCreate = onCreateOpenChange ? createOpen : internalCreate;
  const setShowCreate = onCreateOpenChange ?? setInternalCreate;
  const [offerTarget, setOfferTarget] = useState<TopupRequest | null>(null);
  const [contract, setContract] = useState<TopupRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (showCreate) setFormError(null);
  }, [showCreate]);

  const visible = useMemo(() => {
    if (investorId == null) return requests;
    return requests.filter((r) => r.investor_id === investorId);
  }, [requests, investorId]);

  const openRows = visible.filter((r) => isOpen(r.status));
  const cooling = visible.filter((r) => r.can_reverse_investment);
  const history = visible
    .filter((r) => !isOpen(r.status) && !r.can_reverse_investment)
    .slice(0, investorId == null ? 4 : 8);
  const hasOpenForInvestor = investorId != null && openRows.some((r) => r.investor_id === investorId);

  async function createRequest(amount: number, notes: string) {
    setFormError(null);
    setBusyId(-1);
    try {
      const created = await api.createTopupRequest({
        amount,
        notes: notes || undefined,
      });
      setShowCreate(false);
      onMessage("בקשת המסלול נשלחה");
      onChanged();
      if (created.investor_id) onFocusInvestor?.(created.investor_id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "שליחת הבקשה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelRequest(req: TopupRequest) {
    if (!window.confirm("לבטל את בקשת המסלול? אפשר לפתוח בקשה חדשה אחר כך.")) return;
    setBusyId(req.id);
    try {
      await api.cancelTopupRequest(req.id);
      onMessage("הבקשה בוטלה");
      onChanged();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "ביטול הבקשה נכשל");
    } finally {
      setBusyId(null);
    }
  }

  async function rejectRequest(req: TopupRequest) {
    if (!window.confirm(`לדחות את הבקשה של ${req.investor_name} על סך ${formatMoney(req.amount)}?`)) {
      return;
    }
    setBusyId(req.id);
    try {
      await api.rejectTopupRequest(req.id);
      onMessage(`הבקשה של ${req.investor_name} נדחתה`);
      onChanged();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "דחיית הבקשה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function reverseRequest(req: TopupRequest) {
    if (
      !window.confirm(
        `לבטל את ההשקעה החדשה${isManager ? ` של ${req.investor_name}` : ""}?\nהמסלול ייסגר. הביטול אפשרי רק עד תום 3 ימי עסקים.`,
      )
    ) {
      return;
    }
    setBusyId(req.id);
    try {
      await api.reverseTopupRequest(req.id);
      onMessage("ההשקעה בוטלה בחלון 3 ימי העסקים — המסלול נסגר");
      onChanged();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "ביטול ההשקעה נכשל");
    } finally {
      setBusyId(null);
    }
  }

  async function openContract(req: TopupRequest) {
    setFormError(null);
    setBusyId(req.id);
    try {
      const detail = await api.topupRequest(req.id);
      setContract(detail);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "טעינת החוזה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function offerContract(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!offerTarget) return;
    const fd = new FormData(e.currentTarget);
    setFormError(null);
    setBusyId(offerTarget.id);
    try {
      const offered = await api.approveTopupRequest(offerTarget.id, {
        principal: Number(fd.get("principal") || offerTarget.amount),
        plan_type: String(fd.get("plan_type") || "monthly"),
        monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
        savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
        manager_fee_percent: Number(fd.get("manager_fee_percent") || 0),
        start_date: String(fd.get("start_date") || todayISO()),
        duration_months: Number(fd.get("duration_months") || 12),
        notes: String(fd.get("notes") || "").trim() || undefined,
        generate_schedule: true,
      });
      setOfferTarget(null);
      onMessage(`הוכן חוזה ל-${offered.investor_name} · ${offered.contract_number || ""}`);
      onChanged();
      onFocusInvestor?.(offered.investor_id);
      await openContract(offered);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "הכנת החוזה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function signContract(typedName: string, png: string) {
    if (!contract) return;
    setFormError(null);
    setBusyId(contract.id);
    try {
      const signed = await api.signTopupRequest(contract.id, {
        typed_name: typedName,
        signature_png: png,
        accepted_terms: true,
      });
      const detail = await api.topupRequest(signed.id);
      setContract(detail);
      onChanged();
      if (detail.both_signed || isExecuted(detail.status)) {
        onMessage("שתי החתימות הושלמו · המסלול בוצע והחוזה מוכן להורדה");
      } else {
        onMessage("החתימה נשמרה · ממתין לצד השני");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "החתימה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadPdf() {
    if (!contract) return;
    setPdfBusy(true);
    try {
      const detail = await api.topupRequest(contract.id);
      setContract(detail);
      await downloadContractPdf(detail);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "הורדת החוזה נכשלה");
    } finally {
      setPdfBusy(false);
    }
  }

  const showInvestorCta = !isManager && !hasOpenForInvestor && !onCreateOpenChange;
  const showBoard = openRows.length > 0 || cooling.length > 0 || history.length > 0;

  if (!showBoard && !showInvestorCta && !showCreate && !offerTarget && !contract) {
    return null;
  }

  return (
    <div className="topup-flow">
      {showBoard ? (
        <section className="panel topup-queue">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">{isManager ? "בקשות מסלול" : "הוסף מסלול"}</h2>
              <p className="panel__subtitle">
                {isManager
                  ? "הכן חוזה לפי האחוזים של המשקיע, חתום דיגיטלית, והמסלול יבוצע רק אחרי שתי חתימות."
                  : "עקבו אחרי סטטוס הבקשה, חתמו על החוזה והורידו את הקובץ החתום."}
              </p>
            </div>
          </header>

          {openRows.length > 0 ? (
            <ul className="track-request-list">
              {openRows.map((req) => (
                <li key={req.id} className="track-request">
                  <div className="track-request__top">
                    <div>
                      <p className="track-request__kicker">
                        {req.contract_number || `בקשה #${req.id}`}
                        {isManager ? ` · ${req.investor_name}` : ""}
                      </p>
                      <h3>{formatMoney(req.amount)}</h3>
                      <p className="muted">
                        נפתחה {formatDate(req.created_at)}
                        {req.plan_type ? ` · ${planTypeLabel(req.plan_type)} · ${rateLine(req)}` : ""}
                        {req.start_date ? ` · ${formatDate(req.start_date)}–${formatDate(req.end_date)}` : ""}
                      </p>
                    </div>
                    <span className={`badge badge--${req.status}`}>{statusLabel(req.status)}</span>
                  </div>
                  <StageBar current={stageIndex(req)} />
                  <div className="track-request__actions">
                    {req.status === "contract" ? (
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busyId === req.id}
                        onClick={() => openContract(req)}
                      >
                        {req.both_signed ? "לחוזה" : isManager && !req.manager_signed ? "חתימת מנהל" : "לחוזה ולחתימה"}
                      </button>
                    ) : null}
                    {isManager && req.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          disabled={busyId === req.id}
                          onClick={() => {
                            setFormError(null);
                            setOfferTarget(req);
                          }}
                        >
                          הכנת חוזה
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--ghost"
                          disabled={busyId === req.id}
                          onClick={() => rejectRequest(req)}
                        >
                          דחה
                        </button>
                      </>
                    ) : null}
                    {req.can_cancel_request ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        disabled={busyId === req.id}
                        onClick={() => cancelRequest(req)}
                      >
                        בטל בקשה
                      </button>
                    ) : null}
                    {isManager && req.status === "pending" ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => onFocusInvestor?.(req.investor_id)}
                      >
                        למשקיע
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {cooling.length > 0 ? (
            <div className="topup-history">
              {cooling.map((req) => (
                <article key={req.id} className="topup-card topup-card--approved">
                  <div>
                    <p className="topup-card__kicker">
                      {req.contract_number || "חוזה שבוצע"}
                      {req.created_plan_id ? ` · מסלול #${req.created_plan_id}` : ""}
                    </p>
                    <h3>{formatMoney(req.amount)}</h3>
                    <p className="topup-card__cooling">{coolingCopy(req)}</p>
                  </div>
                  <div className="topup-card__aside">
                    <span className="badge badge--executed">בוצע</span>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => openContract(req)}
                    >
                      חוזה PDF
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--danger"
                      disabled={busyId === req.id}
                      onClick={() => reverseRequest(req)}
                    >
                      בטל השקעה
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className="topup-history topup-history--past">
              {history.map((req) => (
                <article key={req.id} className={`topup-card topup-card--${req.status}`}>
                  <div>
                    <p className="topup-card__kicker">
                      {req.contract_number || (isManager ? req.investor_name : "בקשת מסלול")}
                      {req.created_plan_id ? ` · מסלול #${req.created_plan_id}` : ""}
                    </p>
                    <h3>{formatMoney(req.amount)}</h3>
                    <p className="muted">
                      {formatDate(req.created_at)}
                      {req.plan_type ? ` · ${planTypeLabel(req.plan_type)}` : ""}
                      {req.notes ? ` · ${req.notes}` : ""}
                    </p>
                    {req.status === "rejected" && req.review_notes ? (
                      <p className="muted">{req.review_notes}</p>
                    ) : null}
                  </div>
                  <div className="topup-card__aside">
                    <span className={`badge badge--${req.status}`}>{statusLabel(req.status)}</span>
                    {req.status === "contract" || isExecuted(req.status) ? (
                      <button type="button" className="btn btn--small btn--ghost" onClick={() => openContract(req)}>
                        חוזה
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {showInvestorCta ? (
        <div className="topup-cta-bar">
          <strong>פתיחת מסלול חדש</strong>
          <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
            הוסף מסלול
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <RequestModal title="הוסף מסלול" kicker="בקשה חדשה" onClose={() => setShowCreate(false)}>
          <CreateTrackForm
            key={String(showCreate)}
            busy={busyId === -1}
            error={formError}
            onCancel={() => setShowCreate(false)}
            onSubmit={createRequest}
          />
        </RequestModal>
      ) : null}

      {offerTarget ? (
        <RequestModal
          title={`הכנת חוזה · ${offerTarget.investor_name}`}
          kicker={formatMoney(offerTarget.amount)}
          onClose={() => setOfferTarget(null)}
          wide
        >
          <form className="form" onSubmit={offerContract}>
            <p className="hint">
              קבעו את האחוזים שהמשקיע מקבל, משך המסלול ותאריכי התחלה וסיום. עמלת הניהול נשמרת אצלכם בלבד.
              החוזה ייחתם דיגיטלית לפני ביצוע המסלול.
            </p>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="form__grid">
              <label>
                קרן במסלול החדש (₪)
                <input
                  name="principal"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  defaultValue={offerTarget.amount}
                />
              </label>
              <PlanTrackFields
                defaultPlanType="monthly"
                defaultMonthlyRate={settings?.default_monthly_rate_percent ?? 0}
                defaultSavingsRate={0}
                defaultPrincipal={offerTarget.amount}
              />
              <label className="topup-fee-field">
                עמלת ניהול — לא מוצגת למשקיע
                <input
                  name="manager_fee_percent"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={settings?.default_manager_fee_percent ?? 0}
                />
                <span className="muted rate-field__hint">נשמרת במסלול לצורך הדיווח שלך בלבד</span>
              </label>
              <label>
                יום תחילת המסלול
                <input name="start_date" type="date" defaultValue={todayISO()} required />
              </label>
              <label>
                משך (חודשים)
                <select name="duration_months" defaultValue={settings?.default_duration_months ?? 12}>
                  {[12, 14, 18, 24, 36, 6, 10].map((m) => (
                    <option key={m} value={m}>
                      {m} חודשים
                    </option>
                  ))}
                </select>
              </label>
              <label>
                הערה בחוזה (גלויה למשקיע)
                <input name="notes" placeholder="אופציונלי" />
              </label>
            </div>
            {offerTarget.notes ? <p className="hint">הערת המשקיע: {offerTarget.notes}</p> : null}
            <button type="submit" className="btn btn--primary" disabled={busyId === offerTarget.id}>
              {busyId === offerTarget.id ? "מכין חוזה..." : "הפקת חוזה לחתימה"}
            </button>
          </form>
        </RequestModal>
      ) : null}

      {contract ? (
        <RequestModal
          title={`חוזה ${contract.contract_number || `#${contract.id}`}`}
          kicker={`${contract.investor_name} · ${formatMoney(contract.amount)}`}
          onClose={() => setContract(null)}
          wide
        >
          <div className="contract-view">
            <StageBar current={stageIndex(contract)} />
            <dl className="contract-facts">
              <div>
                <dt>אופן המסלול</dt>
                <dd>{planTypeLabel(contract.plan_type)}</dd>
              </div>
              <div>
                <dt>אחוז צפוי</dt>
                <dd>{rateLine(contract)}</dd>
              </div>
              <div>
                <dt>משך</dt>
                <dd>{contract.duration_months} חודשים</dd>
              </div>
              <div>
                <dt>מתחיל</dt>
                <dd>{formatDate(contract.start_date)}</dd>
              </div>
              <div>
                <dt>מסתיים</dt>
                <dd>{formatDate(contract.end_date)}</dd>
              </div>
              {(contract.plan_type || "monthly") !== "savings" ? (
                <div>
                  <dt>החזר חודשי צפוי</dt>
                  <dd>{formatMoney(contract.monthly_investor_payout || 0)}</dd>
                </div>
              ) : null}
            </dl>
            <ul className="contract-clauses">
              <li>אין אפשרות למשוך את הקרן עד סוף המסלול.</li>
              <li>ביטול אפשרי בתוך 3 ימי עסקים מיום ביצוע ההשקעה — יום השלמת שתי החתימות.</li>
              <li>המסלול מבוצע רק אחרי חתימה דיגיטלית של המנהל ושל המשקיע.</li>
            </ul>
            <div className="sign-grid">
              <SignBlock
                title="חתימת המנהל"
                signed={Boolean(contract.manager_signed)}
                name={contract.manager_signed_name}
                at={contract.manager_signed_at}
                png={contract.manager_signature_png}
                canSign={isManager && contract.status === "contract" && !contract.manager_signed}
                busy={busyId === contract.id}
                error={isManager ? formError : null}
                defaultName={settings?.manager_display_name || contract.manager_party_name || ""}
                onSign={signContract}
              />
              <SignBlock
                title="חתימת המשקיע"
                signed={Boolean(contract.investor_signed)}
                name={contract.investor_signed_name}
                at={contract.investor_signed_at}
                png={contract.investor_signature_png}
                canSign={!isManager && contract.status === "contract" && !contract.investor_signed}
                busy={busyId === contract.id}
                error={!isManager ? formError : null}
                defaultName={contract.investor_name}
                onSign={signContract}
              />
            </div>
            <div className="request-form__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setContract(null)}>
                סגירה
              </button>
              <button type="button" className="btn btn--primary" onClick={downloadPdf} disabled={pdfBusy}>
                {pdfBusy
                  ? "מכין PDF..."
                  : contract.both_signed || isExecuted(contract.status)
                    ? "הורדת חוזה חתום"
                    : "הורדת טיוטת חוזה"}
              </button>
            </div>
          </div>
        </RequestModal>
      ) : null}
    </div>
  );
}

export function PlanCoolingOffBanner({
  planId,
  requestId,
  until,
  daysLeft,
  canCancel,
  onChanged,
  onMessage,
}: {
  planId: number;
  requestId: number;
  until?: string | null;
  daysLeft?: number;
  canCancel: boolean;
  onChanged: () => void;
  onMessage: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!canCancel) return null;

  async function reverse() {
    if (
      !window.confirm(
        `לבטל את מסלול #${planId}?\nהביטול אפשרי רק עד תום 3 ימי עסקים, והמסלול ייסגר.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.reverseTopupRequest(requestId);
      onMessage("ההשקעה בוטלה בחלון 3 ימי העסקים");
      onChanged();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "ביטול ההשקעה נכשל");
    } finally {
      setBusy(false);
    }
  }

  const days = daysLeft ?? 0;
  return (
    <div className="cooling-banner">
      <div>
        <strong>חלון ביטול פתוח</strong>
        <span>
          {until ? `עד ${formatDate(until)}` : "עד 3 ימי עסקים"}
          {days <= 1 ? " · עד סוף יום העסקים" : ` · נשארו ${days} ימי עסקים`}
        </span>
      </div>
      <button type="button" className="btn btn--small btn--ghost btn--danger" disabled={busy} onClick={reverse}>
        בטל השקעה
      </button>
    </div>
  );
}
