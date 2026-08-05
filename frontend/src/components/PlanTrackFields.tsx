import { useState } from "react";
import type { PlanType } from "../types/investments";
import { PLAN_TYPE_OPTIONS, planTypeHint } from "../utils/planTypes";

type Props = {
  defaultPlanType?: PlanType | string;
  defaultMonthlyRate?: number;
  defaultSavingsRate?: number;
  /** When false, only render the type + rate fields (caller owns the grid). */
  wrapInGrid?: boolean;
};

export function PlanTrackFields({
  defaultPlanType = "monthly",
  defaultMonthlyRate = 0,
  defaultSavingsRate = 0,
}: Props) {
  const [planType, setPlanType] = useState<PlanType>(
    (defaultPlanType as PlanType) || "monthly",
  );
  const showMonthly = planType === "monthly" || planType === "hybrid";
  const showSavings = planType === "savings" || planType === "hybrid";

  return (
    <>
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
        <label>
          {planType === "hybrid" ? "אחוז להחזר חודשי" : "אחוז חודשי"}
          <input
            name="monthly_rate_percent"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={defaultMonthlyRate}
          />
        </label>
      ) : (
        <input type="hidden" name="monthly_rate_percent" value="0" />
      )}
      {showSavings ? (
        <label>
          {planType === "hybrid" ? "אחוז לחיסכון (חודשי)" : "אחוז חיסכון חודשי"}
          <input
            name="savings_rate_percent"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={defaultSavingsRate}
          />
        </label>
      ) : (
        <input type="hidden" name="savings_rate_percent" value="0" />
      )}
    </>
  );
}
