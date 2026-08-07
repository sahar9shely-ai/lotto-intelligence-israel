import { FormEvent, useState } from "react";
import { api } from "../services/api";
import type { Plan } from "../types/investments";
import { formatMoney } from "../utils/format";

type Mode = "withdraw" | "transfer" | null;

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
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage || plan.plan_type === "monthly" || available <= 0) {
    return null;
  }

  async function submit(e: FormEvent) {
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
    const label =
      mode === "withdraw"
        ? `למשוך ${formatMoney(value)} מהחיסכון?`
        : `להעביר ${formatMoney(value)} מהחיסכון לקרן?\nההחזר החודשי במזומן יעלה בהתאם.`;
    if (!window.confirm(label)) return;

    setBusy(true);
    setError(null);
    try {
      if (mode === "withdraw") {
        await api.withdrawSavings(plan.id, { amount: value });
      } else {
        await api.transferSavingsToPrincipal(plan.id, { amount: value });
      }
      setMode(null);
      setAmount("");
      onDone();
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
            onClick={() => {
              setMode("withdraw");
              setAmount(String(available));
              setError(null);
            }}
          >
            משיכת חיסכון
          </button>
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => {
              setMode("transfer");
              setAmount(String(available));
              setError(null);
            }}
          >
            העברה לקרן
          </button>
        </div>
      ) : (
        <form className="savings-actions__form" onSubmit={submit}>
          <div className="savings-actions__form-head">
            <strong>
              {mode === "withdraw" ? "משיכת חיסכון" : "העברה לקרן"}
            </strong>
            <span className="muted">זמין {formatMoney(available)}</span>
          </div>
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
            <button type="submit" className="btn btn--small btn--primary" disabled={busy}>
              {busy ? "מבצע..." : "אישור"}
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              disabled={busy}
              onClick={() => {
                setMode(null);
                setError(null);
              }}
            >
              ביטול
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
