import type { AuthUser } from "../types/auth";
import type { TopupRequest } from "../types/investments";

export function parseTopupFocusId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** A notification ID can select an existing owned document, never authorize an action. */
export function ownedTopupFocus(
  requests: TopupRequest[], id: number | null, user: AuthUser | null,
): TopupRequest | null {
  if (!user || user.is_manager || id == null) return null;
  return requests.find(row => row.id === id && row.investor_id === user.investor_id
    && ["contract", "executed", "approved"].includes(row.status)) ?? null;
}

export function matchesTopupDetail(detail: TopupRequest, request: TopupRequest, user: AuthUser | null): boolean {
  return Boolean(user && detail.id === request.id && detail.investor_id === request.investor_id
    && (user.is_manager || detail.investor_id === user.investor_id));
}
