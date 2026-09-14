import type { AuthUser } from "../types/auth";

export const ADMIN_INVESTOR_NAME = "מנהל מערכת";
export const PERSONAL_INVESTOR_NAME = "סהר";

const ADMIN_SHELL_NAMES = new Set(["מנהל מערכת", "מנהל", "מנהלת"]);

/** System operator login — empty portfolio, admin-only workflows. */
export function isAdminAccount(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return (
    user.username === "admin" ||
    (Boolean(user.is_manager) && user.investor_name === ADMIN_INVESTOR_NAME)
  );
}

/** Operational admin row — not an investment book (unlike סהר). */
export function isAdminShellInvestor(inv: {
  name?: string | null;
  is_manager?: boolean;
  active_principal?: number;
} | null | undefined): boolean {
  if (!inv) return false;
  const name = (inv.name || "").trim();
  if (name === PERSONAL_INVESTOR_NAME) return false;
  if (ADMIN_SHELL_NAMES.has(name)) return true;
  return Boolean(inv.is_manager) && !(Number(inv.active_principal) > 0);
}
