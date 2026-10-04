import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { AuthUser } from "../types/auth";
import { api, getToken } from "../services/api";
import { clearBrowserPushOwner, decodePushPublicKey, getBrowserPushOwner, getPushRegistration, PUSH_DETACHING_EVENT, pushSupport, registerPushWorker, setBrowserPushBinding } from "../services/pushNotifications";

type PushState = "checking" | "ready" | "needs_permission" | "denied" | "install_required" | "unsupported" | "unavailable" | "error";
type PushContextValue = {
  state: PushState;
  busy: boolean;
  error: string | null;
  canEnable: boolean;
  enabled: boolean;
  required: boolean | null;
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
  const configuration = useRef<{ enabled: boolean; public_key: string | null; require_notifications: boolean } | null>(null);
  const currentState = useRef<PushState>("checking");
  const verifiedBinding = useRef<{ user_id: number; endpoint: string } | null>(null);
  const knownOwner = useRef<{ user_id: number; endpoint: string } | null>(null);
  const restoredEndpoint = useRef<string | null>(null);
  const checking = useRef<{ request: number; promise: Promise<void> } | null>(null);
  const active = useRef(true);
  const version = useRef(0);
  const busyRef = useRef(false);
  const detaching = useRef(false);
  const valid = (request: number) => active.current && version.current === request;
  const updateState = (nextState: PushState) => { currentState.current = nextState; setState(nextState); };
  const usesCurrentKey = (subscription: PushSubscription, publicKey: string) => {
    const registeredKey = subscription.options?.applicationServerKey;
    if (!registeredKey) return false;
    const registered = new Uint8Array(registeredKey);
    const current = new Uint8Array(decodePushPublicKey(publicKey));
    return registered.length === current.length && registered.every((byte, index) => byte === current[index]);
  };

  async function saveSubscription(request: number, subscription: PushSubscription) {
    const serialized = subscription.toJSON();
    if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new Error("המכשיר לא השלים את רישום ההתראות. אפשר לנסות שוב.");
    await api.pushSubscribe({ endpoint: subscription.endpoint, keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth } });
    if (!valid(request)) return;
    const status = await api.pushSubscriptionStatus(subscription.endpoint);
    if (!valid(request)) return;
    if (!status.subscribed || Notification.permission !== "granted") throw new Error("רישום ההתראות לא הושלם. אפשר לנסות שוב.");
    await setBrowserPushBinding({ user_id: user!.id, endpoint: subscription.endpoint });
    if (!valid(request)) return;
    verifiedBinding.current = { user_id: user!.id, endpoint: subscription.endpoint };
    knownOwner.current = verifiedBinding.current;
    restoredEndpoint.current = subscription.endpoint;
    updateState("ready");
  }

  const refresh = useCallback((): Promise<void> => {
    if (busyRef.current || detaching.current || !active.current) return Promise.resolve();
    if (checking.current) return checking.current.promise;
    const request = ++version.current;
    // Returning to the app checks the device in the background. Keep an already
    // verified portfolio mounted until there is evidence that access was revoked.
    if (currentState.current !== "ready") updateState("checking");
    setError(null);
    const invalidate = async (nextState: PushState) => {
      if (!valid(request)) return;
      verifiedBinding.current = null;
      updateState(nextState);
      await setBrowserPushBinding(null);
    };
    const check = async () => {
      if (!user || user.is_manager) {
        await setBrowserPushBinding(null);
        if (valid(request)) updateState("ready");
        return;
      }
      // Component remounts and page reloads are not logouts. Only an authenticated
      // owner change clears the persisted delivery marker before revalidation.
      const owner = await getBrowserPushOwner();
      if (!valid(request)) return;
      knownOwner.current = owner;
      const differentOwner = owner && owner.user_id !== user.id;
      if (differentOwner) {
        await setBrowserPushBinding(null);
        if (!valid(request)) return;
      }
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
      let subscription = await registration?.pushManager.getSubscription();
      let canRestore = owner?.user_id === user.id;
      if (!valid(request)) return;
      if (differentOwner) {
        if (subscription?.endpoint === owner.endpoint) {
          const removed = await subscription.unsubscribe();
          if (!valid(request)) return;
          if (!removed) throw new Error("לא ניתן לנתק את ההתראות מהחשבון הקודם. סגרו את תזרים ונסו שוב.");
        }
        await clearBrowserPushOwner(owner.endpoint);
        await invalidate("needs_permission");
        return;
      }
      if (subscription) {
        const status = await api.pushSubscriptionStatus(subscription.endpoint);
        if (!valid(request)) return;
        canRestore = canRestore || status.subscribed;
        if (!status.subscribed || !usesCurrentKey(subscription, config.public_key)) {
          if (!canRestore) { await invalidate("needs_permission"); return; }
          // A removed endpoint may have received provider 404/410, or it may be
          // bound to the old VAPID key. Reposting it would not restore delivery.
          await invalidate("checking");
          if (!valid(request)) return;
          if (status.subscribed) {
            const cleanupToken = getToken();
            await api.pushUnsubscribe({ endpoint: subscription.endpoint }, cleanupToken).catch(() => undefined);
            if (!valid(request)) return;
          }
          const removed = await subscription.unsubscribe();
          if (!valid(request)) return;
          if (!removed) throw new Error("לא ניתן לחדש את ההתראות במכשיר הזה. סגרו את תזרים ונסו שוב.");
          subscription = null;
        }
      }
      if (!subscription) {
        // The browser may rotate/expire its endpoint. The already granted
        // permission and same-account enrollment can be restored without a prompt.
        if (!canRestore) { await invalidate("needs_permission"); return; }
        const worker = await registerPushWorker();
        if (!valid(request)) return;
        subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushPublicKey(config.public_key) });
        if (!valid(request)) return;
        await saveSubscription(request, subscription);
        return;
      }
      if (Notification.permission !== "granted") { await invalidate("denied"); return; }
      await setBrowserPushBinding({ user_id: user.id, endpoint: subscription.endpoint });
      if (!valid(request)) return;
      verifiedBinding.current = { user_id: user.id, endpoint: subscription.endpoint };
      updateState("ready");
      // Register the verified existing device once per authenticated session so
      // the server can repair deliveries issued before this device was enrolled.
      if (restoredEndpoint.current !== subscription.endpoint) await saveSubscription(request, subscription);
    };
    let timer: number | undefined;
    const promise = Promise.race([
      check(),
      new Promise<void>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("בדיקת ההתראות מתעכבת. אפשר לנסות שוב.")), 15000);
      }),
    ]).catch(async failure => {
      if (!valid(request)) return;
      // Cancel late completions after a failed/timed-out check. A network outage
      // does not revoke a previously verified device or its delivery marker.
      const failedRequest = ++version.current;
      if (verifiedBinding.current?.user_id === user?.id && pushSupport() === "supported"
        && Notification.permission === "granted") {
        updateState("ready");
        setError("לא ניתן לבדוק כרגע את החיבור להתראות. ההפעלה הקיימת במכשיר נשמרה.");
        return;
      }
      verifiedBinding.current = null;
      updateState("error");
      // A reload can fail before server validation. Keep an existing marker for
      // this authenticated owner, but keep the portfolio gated until validation.
      if (knownOwner.current?.user_id !== user?.id || pushSupport() !== "supported" || Notification.permission !== "granted") {
        await setBrowserPushBinding(null).catch(() => undefined);
      }
      if (!valid(failedRequest)) return;
      setError(failure instanceof Error ? failure.message : "לא ניתן לבדוק את ההתראות כרגע.");
    }).finally(() => {
      window.clearTimeout(timer);
      if (checking.current?.request === request) checking.current = null;
    });
    checking.current = { request, promise };
    return promise;
  }, [user?.id, user?.is_manager]);

  useEffect(() => {
    let effectAlive = true;
    active.current = true;
    void refresh();
    const onFocus = () => {
      // Permission changes are authoritative even while a server check is pending.
      if (verifiedBinding.current && pushSupport() === "supported" && Notification.permission !== "granted") {
        version.current += 1;
        checking.current = null;
        verifiedBinding.current = null;
        updateState(Notification.permission === "denied" ? "denied" : "needs_permission");
        void setBrowserPushBinding(null).catch(() => undefined);
      }
      void refresh();
    };
    const onDetaching = () => {
      detaching.current = true;
      version.current += 1;
      checking.current = null;
      verifiedBinding.current = null;
      busyRef.current = false;
      setBusy(false);
      updateState("checking");
    };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener(PUSH_DETACHING_EVENT, onDetaching);
    document.addEventListener("visibilitychange", onVisible);
    let permission: PermissionStatus | null = null;
    navigator.permissions?.query({ name: "notifications" as PermissionName }).then(result => {
      if (!effectAlive || !active.current) return;
      permission = result;
      permission.addEventListener("change", onFocus);
    }).catch(() => undefined);
    return () => {
      effectAlive = false;
      active.current = false;
      version.current += 1;
      checking.current = null;
      verifiedBinding.current = null;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PUSH_DETACHING_EVENT, onDetaching);
      document.removeEventListener("visibilitychange", onVisible);
      permission?.removeEventListener("change", onFocus);
      // Authentication transitions clear delivery through detachBrowserPush.
      // A React cleanup (including StrictMode) must not disable a dormant PWA.
    };
  }, [refresh]);

  async function enable() {
    if (!user || user.is_manager || busyRef.current || detaching.current || pushSupport() !== "supported") return;
    const config = configuration.current;
    if (!config?.enabled || !config.public_key) return;
    const request = ++version.current;
    checking.current = null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // Request directly from this click, before any asynchronous setup, to preserve the device gesture.
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (!valid(request)) return;
      if (permission !== "granted") {
        updateState(permission === "denied" ? "denied" : "needs_permission");
        return;
      }
      const registration = await registerPushWorker();
      if (!valid(request)) return;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const existing = await api.pushSubscriptionStatus(subscription.endpoint);
        if (!valid(request)) return;
        if (!existing.subscribed || !usesCurrentKey(subscription, config.public_key)) {
          if (existing.subscribed) {
            const cleanupToken = getToken();
            await api.pushUnsubscribe({ endpoint: subscription.endpoint }, cleanupToken).catch(() => undefined);
            if (!valid(request)) return;
          }
          const removed = await subscription.unsubscribe();
          if (!valid(request)) return;
          if (!removed) throw new Error("לא ניתן לחדש את ההתראות במכשיר הזה. סגרו את תזרים ונסו שוב.");
          subscription = null;
        }
      }
      subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushPublicKey(config.public_key) });
      if (!valid(request)) return;
      await saveSubscription(request, subscription);
    } catch (failure) {
      if (!valid(request)) return;
      updateState("error");
      setError(failure instanceof Error ? failure.message : "לא ניתן להפעיל התראות כרגע. אפשר לנסות שוב.");
    } finally {
      if (valid(request)) { busyRef.current = false; setBusy(false); }
    }
  }

  const canEnable = Boolean(configuration.current?.enabled && configuration.current.public_key
    && user && !user.is_manager && pushSupport() === "supported");
  return <PushContext.Provider value={{ state, busy, error, canEnable, enabled: Boolean(configuration.current?.enabled), required: configuration.current?.require_notifications ?? null, enable, refresh }}>{children}</PushContext.Provider>;
}

export function usePushNotifications() {
  const value = useContext(PushContext);
  if (!value) throw new Error("usePushNotifications must be used within PushNotificationsProvider");
  return value;
}
