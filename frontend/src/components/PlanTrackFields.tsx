import { useEffect, useRef, useState } from "react";
import type { PlanType } from "../types/investments";
import { PLAN_TYPE_OPTIONS, planTypeHint } from "../utils/planTypes";

type Props = {
  defaultPlanType?: PlanType | string;
  defaultMonthlyRate?: number;
  defaultSavingsRate?: number;
  defaultPrincipal?: number;
};

type RateMode = "percent" | "amount";

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentFromAmount(amount: number, principal: number): number {
  if (!principal || principal <= 0) return 0;
  return roundRate((amount / principal) * 100);
}

function amountFromPercent(percent: number, principal: number): number {
  if (!principal || principal <= 0) return 0;
  return roundMoney(principal * (percent / 100));
}

function usePrincipalFromForm(anchorRef: React.RefObject<HTMLElement | null>, fallback = 0) {
  const [principal, setPrincipal] = useState(fallback);

  useEffect(() => {
    const root = anchorRef.current;
    const form = root?.closest("form");
    const input = form?.querySelector<HTMLInputElement>('input[name="principal"]');
    if (!input) {
      setPrincipal(fallback);
      return;
    }
    const sync = () => setPrincipal(Number(input.value) || 0);
    sync();
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    return () => {
      input.removeEventListener("input", sync);
      input.removeEventListener("change", sync);
    };
  }, [anchorRef, fallback]);

  return principal;
}

function RateField({
  name,
  percentLabel,
  amountLabel,
  defaultPercent,
  principal,
}: {
  name: string;
  percentLabel: string;
  amountLabel: string;
  defaultPercent: number;
  principal: number;
}) {
  const [mode, setMode] = useState<RateMode>("percent");
  const [percent, setPercent] = useState(roundRate(defaultPercent || 0));
  const [amount, setAmount] = useState(amountFromPercent(defaultPercent || 0, principal));

  // When principal changes while editing by amount, keep the ₪ figure and refresh %.
  useEffect(() => {
    if (mode === "amount") {
      setPercent(percentFromAmount(amount, principal));
    } else {
      setAmount(amountFromPercent(percent, principal));
    }
    // Intentionally depend on principal only for cross-sync of the other field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal]);

  function onPercentChange(value: number) {
    const next = roundRate(Math.max(0, value || 0));
    setPercent(next);
    setAmount(amountFromPercent(next, principal));
  }

  function onAmountChange(value: number) {
    const next = roundMoney(Math.max(0, value || 0));
    setAmount(next);
    setPercent(percentFromAmount(next, principal));
  }

  return (
    <div className="rate-field">
      <div className="rate-field__modes" role="group" aria-label="אופן הזנה">
        <button
          type="button"
          className={mode === "percent" ? "rate-field__mode is-active" : "rate-field__mode"}
          onClick={() => setMode("percent")}
        >
          באחוזים
        </button>
        <button
          type="button"
          className={mode === "amount" ? "rate-field__mode is-active" : "rate-field__mode"}
          onClick={() => setMode("amount")}
        >
          בסכום ₪
        </button>
      </div>

      {mode === "percent" ? (
        <label>
          {percentLabel}
          <input
            name={name}
            type="number"
            min="0"
            step="0.01"
            required
            value={percent}
            onChange={(e) => onPercentChange(Number(e.target.value))}
          />
        </label>
      ) : (
        <>
          <label>
            {amountLabel}
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => onAmountChange(Number(e.target.value))}
            />
          </label>
          <input type="hidden" name={name} value={percent} />
          <p className="muted rate-field__hint">
            {principal > 0
              ? `= ${percent.toLocaleString("he-IL", { maximumFractionDigits: 4 })}% מהקרן`
              : "הזיני קרן כדי לחשב אחוזים מהסכום"}
          </p>
        </>
      )}

      {mode === "percent" && principal > 0 ? (
        <p className="muted rate-field__hint">
          ≈ {amount.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪ לחודש
        </p>
      ) : null}
    </div>
  );
}

export function PlanTrackFields({
  defaultPlanType = "monthly",
  defaultMonthlyRate = 0,
  defaultSavingsRate = 0,
  defaultPrincipal = 0,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [planType, setPlanType] = useState<PlanType>(
    (defaultPlanType as PlanType) || "monthly",
  );
  const principal = usePrincipalFromForm(rootRef, defaultPrincipal);
  const showMonthly = planType === "monthly" || planType === "hybrid";
  const showSavings = planType === "savings" || planType === "hybrid";

  return (
    <div ref={rootRef} className="plan-track-fields">
      <label>
        סוג מסלול
        <select
          name="plan_type"
          value={planType}
          onChange={(e) => setPlanType(e.target.value as PlanType)}
        >
          {PLAN_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
        {planTypeHint(planType)}
      </p>
      {showMonthly ? (
        <RateField
          name="monthly_rate_percent"
          percentLabel={planType === "hybrid" ? "אחוז להחזר חודשי" : "אחוז חודשי"}
          amountLabel={planType === "hybrid" ? "החזר חודשי (₪)" : "החזר חודשי (₪)"}
          defaultPercent={defaultMonthlyRate}
          principal={principal}
        />
      ) : (
        <input type="hidden" name="monthly_rate_percent" value="0" />
      )}
      {showSavings ? (
        <RateField
          name="savings_rate_percent"
          percentLabel={planType === "hybrid" ? "אחוז לחיסכון (חודשי)" : "אחוז חיסכון חודשי"}
          amountLabel={planType === "hybrid" ? "סכום לחיסכון בחודש (₪)" : "סכום חיסכון בחודש (₪)"}
          defaultPercent={defaultSavingsRate}
          principal={principal}
        />
      ) : (
        <input type="hidden" name="savings_rate_percent" value="0" />
      )}
    </div>
  );
}
