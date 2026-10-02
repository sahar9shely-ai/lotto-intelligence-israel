import type { PlanAgreement } from "../types/investments";

/** SQLite may return naive UTC; browser parsing otherwise treats it as local time. */
export function isAgreementExpired(row: Pick<PlanAgreement, "expires_at">, now = Date.now()) {
  const value = row.expires_at;
  const utcValue = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const expires = new Date(utcValue).getTime();
  return !Number.isFinite(expires) || expires <= now;
}
