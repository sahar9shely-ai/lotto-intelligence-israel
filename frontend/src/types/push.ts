import type { AuthUser } from "./auth";

export function isAdminPushAccount(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.is_active !== false && user.is_manager && user.username === "admin");
}

export function canUseDevicePush(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.is_active !== false && (!user.is_manager || isAdminPushAccount(user)));
}

export type PushDeliveryStatus = {
  subscribed: boolean;
  pending: number;
  last_delivery: {
    status: "queued" | "sending" | "sent" | "failed" | "cancelled";
    error: "provider_rejected" | "temporarily_unavailable" | null;
    sent_at: string | null;
  } | null;
};

export type PushTestResult = {
  status: "sending" | "queued" | "sent" | "failed" | "cancelled";
  message: string;
};
