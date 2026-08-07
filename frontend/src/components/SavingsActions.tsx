import { FormEvent, useMemo, useState } from "react";
import { api } from "../services/api";
import type { Plan } from "../types/investments";
import { formatMoney, yearStartISO } from "../utils/format";

type Mode = "withdraw" | "transfer" | null;
type Outcome = "continue_new_track" | "close_plan" | null;
type Step = "amount" | "outcome" | "details";

function todayMonthStart(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-01`;
}

export function SavingsActions({
  plan,
  onDone,
  canManage = false,
}: {
  plan: Plan;
  onDone: () => void;
  /** Manager-only money moves — investors never see these controls. */
  canManage?: boolean;
}) {
  const available = Number(plan.current_savings_balance || 0);
  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [compoundSavings, setCompoundSavings] = useState(true);
  const [includeMonthlyCash, setIncludeMonthlyCash] = useState(true);
  const [monthlyRate, setMonthlyRate] = useState(
    String(plan.monthly_rate_percent || 0),
  );
  const [savingsRate, setSavingsRate] = useState(
    String(plan.savings_rate_percent || 0),
  );
  const [managerFee, setManagerFee] = useState(
    String(plan.manager_fee_percent || 0),
  );
  const [duration, setDuration] = useState("12");
  const [startDate, setStartDate] = useState(todayMonthStart());
  const [newPrincipal, setNewPrincipal] = useState("");
  const [withdrawRemaining, setWithdrawRemaining] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountValue = Number(amount);
  const previewPrincipal = useMemo(() => {
    const base = Number(plan.principal || 0);
    const amt = Number.isFinite(amountValue) ? amountValue : 0;
    const afterTransfer =
      mode === "transfer" ? base + Math.min(amt, available) : base;
    // Leftover savings rolls into קרן when continuing.
    const leftover = Math.max(0, available - Math.min(amt, available));
    return Math.round((afterTransfer + leftover) * 100) / 100;
  }, [plan.principal, mode, amountValue, available]);

  if (
    !canManage ||
    plan.status === "completed" ||
    plan.plan_type === "monthly" ||
    available <= 0
  ) {
    return null;
  }

  function resetAll() {
    setMode(null);
    setStep("amount");
    setOutcome(null);
    setError(null);
    setAmount("");
    setCompoundSavings(true);
    setIncludeMonthlyCash(plan.plan_type !== "savings");
    setMonthlyRate(String(plan.monthly_rate_percent || 0));
    setSavingsRate(String(plan.savings_rate_percent || 0));
    setManagerFee(String(plan.manager_fee_percent || 0));
    setDuration("12");
    setStartDate(todayMonthStart());
    setNewPrincipal("");
    setWithdrawRemaining(true);
  }

  function openMode(next: Mode) {
    setMode(next);
    setStep("amount");
    setOutcome(null);
    setAmount(String(available));
    setNewPrincipal("");
    setError(null);
  }

  function goOutcome(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("הזן סכום חיובי");
      return;
    }
    if (value > available + 0.001) {
      setError(`היתרה הזמינה היא ${formatMoney(available)}`);
      return;
    }
    setError(null);
    setStep("outcome");
  }

  function goDetails(next: Outcome) {
    setOutcome(next);
    setError(null);
    if (next === "continue_new_track") {
      setNewPrincipal(String(previewPrincipal));
      setStep("details");
    } else {
      setStep("details");
    }
  }

  async function submitSettle(e: FormEvent) {
    e.preventDefault();
    if (!mode || !outcome) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("הזן סכום חיובי");
      return;
    }

    if (outcome === "continue_new_track") {
      if (!compoundSavings && !includeMonthlyCash) {
        setError("בחר לפחות החזר חודשי או צבירת חיסכון");
        return;
      }
      if (compoundSavings && Number(savingsRate) <= 0) {
        setError("לריבית דריבית צריך אחוז חיסכון");
        return;
      }
      if (includeMonthlyCash && Number(monthlyRate) <= 0) {
        setError("להחזר חודשי צריך אחוז גדול מאפס");
        return;
      }
      if (Number(newPrincipal) <= 0) {
        setError("הזן קרן למסלול החדש");
        return;
      }
    }

    const confirmLabel =
      outcome === "close_plan"
        ? `לסגור את מסלול #${plan.id} לגמרי אחרי ${
            mode === "withdraw" ? "משיכה" : "העברה לקרן"
          } של ${formatMoney(value)}?\nהמסלול יועבר לתיקים סגורים.`
        : `לסגור את מסלול #${plan.id} ולפתוח מסלול חדש?\nקרן חדשה ${formatMoney(
            Number(newPrincipal),
          )} · ${duration} חודשים.`;

    if (!window.confirm(confirmLabel)) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.settleSavings(plan.id, {
        action_type:
          mode === "withdraw" ? "withdraw" : "transfer_to_principal",
        amount: value,
        outcome,
        withdraw_remaining: withdrawRemaining,
        compound_savings: compoundSavings,
        include_monthly_cash: includeMonthlyCash,
        monthly_rate_percent: Number(monthlyRate) || 0,
        savings_rate_percent: Number(savingsRate) || 0,
        manager_fee_percent: Number(managerFee) || 0,
        new_principal:
          outcome === "continue_new_track"
            ? Number(newPrincipal)
            : undefined,
        new_duration_months: Number(duration) || 12,
        new_start_date:
          outcome === "continue_new_track"
            ? startDate || yearStartISO()
            : undefined,
      });
      resetAll();
      onDone();
      if (result.outcome === "continue_new_track" && result.new_plan) {
        window.alert(
          `המסלול הישן נסגר. נפתח מסלול חדש #${result.new_plan.id}.`,
        );
      } else {
        window.alert(`מסלול #${plan.id} נסגר לגמרי והועבר לתיקים סגורים.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="savings-actions">
      {!mode ? (
        <div className="savings-actions__row">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => openMode("withdraw")}
          >
            משיכת חיסכון
          </button>
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => openMode("transfer")}
          >
            העברה לקרן
          </button>
        </div>
      ) : (
        <div className="savings-actions__form savings-actions__wizard">
          <div className="savings-actions__form-head">
            <strong>
              {mode === "withdraw" ? "משיכת חיסכון" : "העברה לקרן"}
              {step === "outcome"
                ? " · המשך?"
                : step === "details"
                  ? outcome === "close_plan"
                    ? " · סגירה"
                    : " · מסלול חדש"
                  : ""}
            </strong>
            <span className="muted">זמין {formatMoney(available)}</span>
          </div>

          {step === "amount" ? (
            <form onSubmit={goOutcome}>
              <label>
                סכום (₪)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={available}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="savings-actions__row">
                <button type="submit" className="btn btn--small btn--primary">
                  המשך
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={resetAll}
                >
                  ביטול
                </button>
              </div>
            </form>
          ) : null}

          {step === "outcome" ? (
            <div className="savings-actions__choices">
              <p className="muted" style={{ margin: 0 }}>
                אחרי {mode === "withdraw" ? "המשיכה" : "ההעברה לקרן"} — מה עושים עם
                המסלול?
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => goDetails("continue_new_track")}
              >
                המשך מסלול חדש
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => goDetails("close_plan")}
              >
                משיכת כל הכספים וסגירה מלאה
              </button>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="savings-actions__row">
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => {
                    setStep("amount");
                    setOutcome(null);
                  }}
                >
                  חזרה
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={resetAll}
                >
                  ביטול
                </button>
              </div>
            </div>
          ) : null}

          {step === "details" && outcome === "close_plan" ? (
            <form onSubmit={submitSettle}>
              <p style={{ margin: 0 }}>
                המסלול ייסגר לגמרי ויופיע תחת <strong>תיקים סגורים</strong>.
              </p>
              <label className="savings-actions__check">
                <input
                  type="checkbox"
                  checked={withdrawRemaining}
                  onChange={(e) => setWithdrawRemaining(e.target.checked)}
                />
                משוך גם את יתרת החיסכון שנשארת אחרי הפעולה
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="savings-actions__row">
                <button
                  type="submit"
                  className="btn btn--small btn--primary"
                  disabled={busy}
                >
                  {busy ? "סוגר..." : "סגור מסלול"}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  disabled={busy}
                  onClick={() => setStep("outcome")}
                >
                  חזרה
                </button>
              </div>
            </form>
          ) : null}

          {step === "details" && outcome === "continue_new_track" ? (
            <form className="savings-actions__details" onSubmit={submitSettle}>
              <p className="muted" style={{ margin: 0 }}>
                המסלול הנוכחי ייסגר. יתרת חיסכון שלא נמשכה תתווסף לקרן החדשה.
              </p>

              <fieldset className="savings-actions__fieldset">
                <legend>מה נצבר במסלול החדש?</legend>
                <label className="savings-actions__check">
                  <input
                    type="checkbox"
                    checked={compoundSavings}
                    onChange={(e) => setCompoundSavings(e.target.checked)}
                  />
                  לצבור לריבית דריבית (עוד 12 חודשים)
                </label>
                <label className="savings-actions__check">
                  <input
                    type="checkbox"
                    checked={includeMonthlyCash}
                    onChange={(e) => setIncludeMonthlyCash(e.target.checked)}
                  />
                  החזר חודשי במזומן
                </label>
              </fieldset>

              <div className="savings-actions__grid">
                <label>
                  קרן למסלול החדש (₪)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={newPrincipal}
                    onChange={(e) => setNewPrincipal(e.target.value)}
                    required
                  />
                </label>
                {includeMonthlyCash ? (
                  <label>
                    אחוז החזר חודשי
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={monthlyRate}
                      onChange={(e) => setMonthlyRate(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
                {compoundSavings ? (
                  <label>
                    אחוז חיסכון חודשי
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={savingsRate}
                      onChange={(e) => setSavingsRate(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
                <label>
                  אחוז עמלת ניהול
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={managerFee}
                    onChange={(e) => setManagerFee(e.target.value)}
                  />
                </label>
                <label>
                  משך (חודשים)
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    required
                  />
                </label>
                <label>
                  תאריך התחלה
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </label>
              </div>

              {error ? <p className="form-error">{error}</p> : null}
              <div className="savings-actions__row">
                <button
                  type="submit"
                  className="btn btn--small btn--primary"
                  disabled={busy}
                >
                  {busy ? "פותח..." : "סגור ישן ופתח חדש"}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  disabled={busy}
                  onClick={() => setStep("outcome")}
                >
                  חזרה
                </button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}
