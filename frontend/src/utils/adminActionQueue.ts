import type { AuthUser } from "../types/auth";
import type { Investor, PlanAgreement, TopupRequest } from "../types/investments";
import { isAgreementExpired } from "./agreementSigning";

/** Match the server's system-admin identity; a portfolio name is not an identity. */
export function isActionQueueAdmin(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.is_active !== false && user.username === "admin" && (user.is_manager || user.role === "manager"));
}

export function investorOperationsHref(investorId: number, section: "documents" | "requests") {
  return `/investors?investor_id=${investorId}&section=${section}`;
}

export function pendingInvestorRequests(rows: TopupRequest[], investorIds: number[]) {
  const allowed = new Set(investorIds);
  return rows.filter(row => allowed.has(row.investor_id) && (row.status === "pending" || row.status === "contract"))
    .sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending") || a.created_at.localeCompare(b.created_at) || a.id - b.id);
}

export function requestOperationsHint(row: TopupRequest) {
  if (row.status === "pending") return "ממתינה לבדיקת מנהל";
  if (row.both_signed || row.contract_fully_signed) return "חוזה חתום · לבדיקה בתיק";
  if (!row.manager_signed) return "ממתין לחתימת מנהל";
  if (!row.investor_signed) return "ממתין לחתימת המשקיע";
  return "חוזה ממתין להשלמה";
}

export type PendingAgreementQueue = {
  rows: PlanAgreement[];
  failedInvestors: { id: number; name: string }[];
};

/** Existing agreement reads are per investor; limit concurrent requests and retain partial successes. */
export async function loadPendingAgreementQueue(
  investors: Pick<Investor, "id" | "name">[],
  read: (investorId: number) => Promise<PlanAgreement[]>,
  now = Date.now(),
): Promise<PendingAgreementQueue> {
  const rows: PlanAgreement[] = [];
  const failedInvestors: PendingAgreementQueue["failedInvestors"] = [];
  let next = 0;
  async function worker() {
    while (next < investors.length) {
      const investor = investors[next++];
      try {
        const result = await read(investor.id);
        rows.push(...result.filter(row => row.investor_id === investor.id && row.status === "pending"));
      } catch {
        failedInvestors.push({ id: investor.id, name: investor.name });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, investors.length) }, worker));
  rows.sort((a, b) => Number(isAgreementExpired(b, now)) - Number(isAgreementExpired(a, now)) || a.created_at.localeCompare(b.created_at) || a.id - b.id);
  failedInvestors.sort((a, b) => a.id - b.id);
  return { rows, failedInvestors };
}
