import type { AuthUser } from "../types/auth";

/** System operator login — empty portfolio, admin-only workflows. */
export function isAdminAccount(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return (
    user.username === "admin" ||
    (Boolean(user.is_manager) && user.investor_name === "מנהל מערכת")
  );
}
