import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { PlanTrackFields } from "./PlanTrackFields";
import { api } from "../services/api";
import type { Settings, TopupRequest } from "../types/investments";
import { formatDate, formatMoney, statusLabel, todayISO } from "../utils/format";

function coolingCopy(req: TopupRequest): string {
  const until = req.cancel_until ? formatDate(req.cancel_until) : "";
  const days = req.cooling_off_days_left;
  if (!req.can_reverse_investment) return "";
  if (days <= 1) return `ניתן לבטל עד ${until} · עד סוף יום העסקים`;
  return `ניתן לבטל עד ${until} · נשארו ${days} ימי עסקים`;
}

function RequestModal({
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
            סגור
          </button>
        </header>
        {children}
      </div>
    </div>
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
}: {
  isManager: boolean;
  investorId?: number | null;
  settings: Settings | null;
  requests: TopupRequest[];
  onChanged: () => void;
  onMessage: (text: string) => void;
  onFocusInvestor?: (investorId: number) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [approveTarget, setApproveTarget] = useState<TopupRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (investorId == null) return requests;
    return requests.filter((r) => r.investor_id === investorId);
  }, [requests, investorId]);

  const pending = visible.filter((r) => r.status === "pending");
  const cooling = visible.filter((r) => r.can_reverse_investment);
  const history = visible
    .filter((r) => r.status !== "pending" && !r.can_reverse_investment)
    .slice(0, investorId == null ? 4 : 6);
  const hasPendingForInvestor =
    investorId != null && pending.some((r) => r.investor_id === investorId);

  async function createRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount") || 0);
    const notes = String(fd.get("notes") || "").trim();
    setFormError(null);
    setBusyId(-1);
    try {
      const created = await api.createTopupRequest({
        amount,
        notes: notes || undefined,
      });
      setShowCreate(false);
      onMessage("הבקשה נשלחה. אפשר לבטל אותה כל עוד היא ממתינה לאישור.");
      onChanged();
      if (created.investor_id) onFocusInvestor?.(created.investor_id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "שליחת הבקשה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelRequest(req: TopupRequest) {
    if (!window.confirm("לבטל את בקשת התוספת? אפשר לפתוח בקשה חדשה אחר כך.")) return;
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

  async function approveRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!approveTarget) return;
    const fd = new FormData(e.currentTarget);
    setFormError(null);
    setBusyId(approveTarget.id);
    try {
      const approved = await api.approveTopupRequest(approveTarget.id, {
        principal: Number(fd.get("principal") || approveTarget.amount),
        plan_type: String(fd.get("plan_type") || "monthly"),
        monthly_rate_percent: Number(fd.get("monthly_rate_percent") || 0),
        savings_rate_percent: Number(fd.get("savings_rate_percent") || 0),
        manager_fee_percent: Number(fd.get("manager_fee_percent") || 0),
        start_date: String(fd.get("start_date") || todayISO()),
        duration_months: Number(fd.get("duration_months") || 12),
        notes: String(fd.get("notes") || "").trim() || undefined,
        generate_schedule: true,
      });
      setApproveTarget(null);
      onMessage(
        `אושר מסלול חדש ל-${approved.investor_name} · קרן ${formatMoney(approved.amount)}`,
      );
      onChanged();
      onFocusInvestor?.(approved.investor_id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "אישור הבקשה נכשל");
    } finally {
      setBusyId(null);
    }
  }

  const showInvestorCta = !isManager && !hasPendingForInvestor;
  const showHistory = investorId != null && history.length > 0;

  if (
    pending.length === 0 &&
    !showInvestorCta &&
    cooling.length === 0 &&
    !showHistory &&
    !showCreate &&
    !approveTarget
  ) {
    return null;
  }

  return (
    <div className="topup-flow">
      {pending.length > 0 ? (
        <section className="panel topup-queue">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">
                {isManager ? "בקשות תוספת ממתינות" : "בקשה ממתינה לאישור"}
              </h2>
              <p className="panel__subtitle">
                {isManager
                  ? "אשר כמסלול חדש ובחר את האחוזים שהמשקיע מקבל. עמלת הניהול נשארת אצלך בלבד."
                  : "הבקשה אצל המנהל. אפשר לבטל אותה כל עוד היא לא אושרה."}
              </p>
            </div>
          </header>
          <ul className="list">
            {pending.map((req) => (
              <li key={req.id} className="list__row topup-row">
                <div>
                  <strong>
                    {isManager ? (
                      <button
                        type="button"
                        className="text-link topup-row__name"
                        onClick={() => onFocusInvestor?.(req.investor_id)}
                      >
                        {req.investor_name}
                      </button>
                    ) : null}
                    {isManager ? " · " : ""}
                    {formatMoney(req.amount)}
                  </strong>
                  <span className="muted">
                    נפתחה {formatDate(req.created_at)}
                    {req.notes ? ` · ${req.notes}` : ""}
                  </span>
                </div>
                <div className="page-head__actions">
                  <span className="badge badge--pending">{statusLabel(req.status)}</span>
                  {isManager ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busyId === req.id}
                        onClick={() => {
                          setFormError(null);
                          setApproveTarget(req);
                        }}
                      >
                        אשר כמסלול
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
                  ) : req.can_cancel_request ? (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      disabled={busyId === req.id}
                      onClick={() => cancelRequest(req)}
                    >
                      בטל בקשה
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showInvestorCta ? (
        <div className="topup-cta-bar">
          <strong>רוצה להוסיף להשקעה?</strong>
          <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
            בקשת תוספת להשקעה
          </button>
        </div>
      ) : null}

      {cooling.length > 0 ? (
        <div className="topup-history">
          {cooling.map((req) => (
            <article key={req.id} className="topup-card topup-card--approved">
              <div>
                <p className="topup-card__kicker">
                  {isManager ? req.investor_name : "השקעה חדשה"}
                  {req.created_plan_id ? ` · מסלול #${req.created_plan_id}` : ""}
                </p>
                <h3>{formatMoney(req.amount)}</h3>
                <p className="topup-card__cooling">{coolingCopy(req)}</p>
              </div>
              <div className="topup-card__aside">
                <span className="badge badge--approved">אושרה</span>
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

      {showHistory ? (
        <div className="topup-history topup-history--past">
          {history.map((req) => (
            <article key={req.id} className={`topup-card topup-card--${req.status}`}>
              <div>
                <p className="topup-card__kicker">
                  {isManager ? req.investor_name : "בקשת תוספת"}
                  {req.created_plan_id ? ` · מסלול #${req.created_plan_id}` : ""}
                </p>
                <h3>{formatMoney(req.amount)}</h3>
                <p className="muted">
                  {formatDate(req.created_at)}
                  {req.notes ? ` · ${req.notes}` : ""}
                </p>
                {req.status === "rejected" && req.review_notes ? (
                  <p className="muted">{req.review_notes}</p>
                ) : null}
              </div>
              <span className={`badge badge--${req.status}`}>{statusLabel(req.status)}</span>
            </article>
          ))}
        </div>
      ) : null}

      {showCreate ? (
        <RequestModal title="בקשת תוספת להשקעה" onClose={() => setShowCreate(false)}>
          <form className="form" onSubmit={createRequest}>
            <p className="hint">
              כתוב את הסכום שברצונך להוסיף. אחרי האישור יתווסף מסלול חדש — אפשר לבטל אותו עד 3
              ימי עסקים.
            </p>
            {formError ? <p className="form-error">{formError}</p> : null}
            <label>
              סכום להוספה (₪)
              <input
                name="amount"
                type="number"
                min="1"
                step="0.01"
                required
                placeholder="לדוגמה 20000"
                autoFocus
              />
            </label>
            <label>
              הערה למנהל
              <textarea
                name="notes"
                rows={3}
                placeholder="אופציונלי — מטרה, תזמון, או כל פרט שחשוב"
              />
            </label>
            <button type="submit" className="btn btn--primary" disabled={busyId === -1}>
              {busyId === -1 ? "שולח..." : "שלח בקשה"}
            </button>
          </form>
        </RequestModal>
      ) : null}

      {approveTarget ? (
        <RequestModal
          title={`אישור מסלול חדש · ${approveTarget.investor_name}`}
          onClose={() => setApproveTarget(null)}
        >
          <form className="form" onSubmit={approveRequest}>
            <p className="hint">
              בחר את האחוזים שהמשקיע מקבל. עמלת הניהול נשמרת אצלך בלבד ולא מוצגת לו.
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
                  defaultValue={approveTarget.amount}
                />
              </label>
              <PlanTrackFields
                defaultPlanType="monthly"
                defaultMonthlyRate={settings?.default_monthly_rate_percent ?? 0}
                defaultSavingsRate={0}
                defaultPrincipal={approveTarget.amount}
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
                <span className="muted rate-field__hint">
                  נשמרת במסלול לצורך הדיווח שלך בלבד
                </span>
              </label>
              <label>
                תאריך התחלת המסלול
                <input name="start_date" type="date" defaultValue={todayISO()} required />
                <span className="muted rate-field__hint">ברירת מחדל: היום — לא תחילת השנה</span>
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
                הערה במסלול (גלויה למשקיע)
                <input name="notes" placeholder="אופציונלי" />
              </label>
            </div>
            {approveTarget.notes ? (
              <p className="hint">הערת המשקיע: {approveTarget.notes}</p>
            ) : null}
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busyId === approveTarget.id}
            >
              {busyId === approveTarget.id ? "מאשר..." : "אשר והוסף מסלול"}
            </button>
          </form>
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
          {days <= 1
            ? " · עד סוף יום העסקים"
            : ` · נשארו ${days} ימי עסקים`}
        </span>
      </div>
      <button
        type="button"
        className="btn btn--small btn--ghost btn--danger"
        disabled={busy}
        onClick={reverse}
      >
        בטל השקעה
      </button>
    </div>
  );
}
