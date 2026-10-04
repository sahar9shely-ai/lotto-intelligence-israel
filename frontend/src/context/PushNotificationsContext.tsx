import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { AuthUser } from "../types/auth";
import { api } from "../services/api";
import { decodePushPublicKey, getPushRegistration, PUSH_DETACHING_EVENT, pushSupport, registerPushWorker, setBrowserPushBinding } from "../services/pushNotifications";

type PushState = "checking" | "ready" | "needs_permission" | "denied" | "install_required" | "unsupported" | "unavailable" | "error";
type PushContextValue = {
  state: PushState;
  busy: boolean;
  error: string | null;
  canEnable: boolean;
  enabled: boolean;
  enable: () => Promise<void>;
  refresh: () => Promise<void>;
};
const PushContext = createContext<PushContextValue | null>(null);

export function PushNotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <PushSession key={`${user?.id ?? "guest"}:${Boolean(user?.is_manager)}`} user={user}>{children}</PushSession>;
}

function PushSession({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configuration = useRef<{ enabled: boolean; public_key: string | null } | null>(null);
  const active = useRef(true);
  const version = useRef(0);
  const busyRef = useRef(false);
  const detaching = useRef(false);
  const initialized = useRef(false);
  const valid = (request: number) => active.current && version.current === request;

  const refresh = useCallback(async () => {
    if (busyRef.current || detaching.current) return;
    const request = ++version.current;
    setState("checking");
    setError(null);
    const invalidate = async (nextState: PushState) => {
      if (!valid(request)) return;
      await setBrowserPushBinding(null);
      if (valid(request)) setState(nextState);
    };
    try {
      if (!initialized.current) {
        await setBrowserPushBinding(null);
        initialized.current = true;
      }
      if (!valid(request)) return;
      if (!user || user.is_manager) { setState("ready"); return; }
      const config = await api.pushConfig();
      if (!valid(request)) return;
      configuration.current = config;
      if (!config.enabled || !config.public_key) {
        await invalidate(config.require_notifications ? "unavailable" : "ready");
        return;
      }
      const support = pushSupport();
      if (support !== "supported") { await invalidate(support); return; }
      if (Notification.permission !== "granted") {
        await invalidate(Notification.permission === "denied" ? "denied" : "needs_permission");
        return;
      }
      const registration = await getPushRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!valid(request)) return;
      if (!subscription) { await invalidate("needs_permission"); return; }
      const status = await api.pushSubscriptionStatus(subscription.endpoint);
      if (!valid(request)) return;
      if (!status.subscribed) { await invalidate("needs_permission"); return; }
      if (Notification.permission !== "granted") { await invalidate("denied"); return; }
      await setBrowserPushBinding({ user_id: user.id, endpoint: subscription.endpoint });
      if (valid(request)) setState("ready");
    } catch (failure) {
      if (!valid(request)) return;
      await setBrowserPushBinding(null).catch(() => undefined);
      if (!valid(request)) return;
      setState("error");
      setError(failure instanceof Error ? failure.message : "לא ניתן לבדוק את ההתראות כרגע.");
    }
  }, [user?.id, user?.is_manager]);

  useEffect(() => {
    active.current = true;
    void refresh();
    const onFocus = () => void refresh();
    const onDetaching = () => {
      detaching.current = true;
      version.current += 1;
      busyRef.current = false;
      setBusy(false);
      setState("checking");
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener(PUSH_DETACHING_EVENT, onDetaching);
    document.addEventListener("visibilitychange", onVisible);
    let permission: PermissionStatus | null = null;
    navigator.permissions?.query({ name: "notifications" as PermissionName }).then(result => {
      if (!active.current) return;
      permission = result;
      permission.addEventListener("change", onFocus);
    }).catch(() => undefined);
    return () => {
      active.current = false;
      version.current += 1;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PUSH_DETACHING_EVENT, onDetaching);
      document.removeEventListener("visibilitychange", onVisible);
      permission?.removeEventListener("change", onFocus);
      void setBrowserPushBinding(null).catch(() => undefined);
    };
  }, [refresh]);

  async function enable() {
    if (!user || user.is_manager || busyRef.current || detaching.current || pushSupport() !== "supported") return;
    const config = configuration.current;
    if (!config?.enabled || !config.public_key) return;
    const request = ++version.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // Request directly from this click, before any asynchronous setup, to preserve the device gesture.
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (!valid(request)) return;
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "needs_permission");
        return;
      }
      const registration = await registerPushWorker();
      if (!valid(request)) return;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const existing = await api.pushSubscriptionStatus(subscription.endpoint);
        if (!valid(request)) return;
        if (!existing.subscribed) {
          const removed = await subscription.unsubscribe();
          if (!valid(request)) return;
          if (!removed) throw new Error("לא ניתן לחדש את ההתראות במכשיר הזה. סגרו את תזרים ונסו שוב.");
          subscription = null;
        }
      }
      subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushPublicKey(config.public_key) });
      if (!valid(request)) return;
      const serialized = subscription.toJSON();
      if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new Error("המכשיר לא השלים את רישום ההתראות. אפשר לנסות שוב.");
      await api.pushSubscribe({ endpoint: subscription.endpoint, keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth } });
      if (!valid(request)) return;
      const status = await api.pushSubscriptionStatus(subscription.endpoint);
      if (!valid(request)) return;
      if (!status.subscribed || Notification.permission !== "granted") throw new Error("רישום ההתראות לא הושלם. אפשר לנסות שוב.");
      await setBrowserPushBinding({ user_id: user.id, endpoint: subscription.endpoint });
      if (valid(request)) setState("ready");
    } catch (failure) {
      if (!valid(request)) return;
      setState("error");
      setError(failure instanceof Error ? failure.message : "לא ניתן להפעיל התראות כרגע. אפשר לנסות שוב.");
    } finally {
      if (valid(request)) { busyRef.current = false; setBusy(false); }
    }
  }

  const canEnable = Boolean(configuration.current?.enabled && configuration.current.public_key
    && user && !user.is_manager && pushSupport() === "supported");
  return <PushContext.Provider value={{ state, busy, error, canEnable, enabled: Boolean(configuration.current?.enabled), enable, refresh }}>{children}</PushContext.Provider>;
}

export function usePushNotifications() {
  const value = useContext(PushContext);
  if (!value) throw new Error("usePushNotifications must be used within PushNotificationsProvider");
  return value;
}
