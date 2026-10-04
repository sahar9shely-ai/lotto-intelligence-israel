import { api, getToken } from "./api";

const BINDING_DB = "tazrim-push-binding";
const BINDING_STORE = "binding";
export const PUSH_DETACHING_EVENT = "tazrim:push-detaching";
let bindingQueue: Promise<unknown> = Promise.resolve();

export type BrowserPushBinding = { user_id: number; endpoint: string } | null;

/** Only a browser/account marker is stored here. Never store authentication or portfolio data. */
export function setBrowserPushBinding(binding: BrowserPushBinding): Promise<void> {
  const write = bindingQueue.catch(() => undefined).then(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(BINDING_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(BINDING_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(BINDING_STORE, "readwrite");
      const store = transaction.objectStore(BINDING_STORE);
      store.put(binding, "current");
      // Enrollment survives logout, but delivery/navigation never uses this owner hint.
      if (binding) store.put(binding, "owner");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
  bindingQueue = write;
  return write;
}

/** A non-authenticating hint. The current account must still verify ownership with the server. */
export function getBrowserPushOwner(): Promise<BrowserPushBinding> {
  return bindingQueue.catch(() => undefined).then(() => new Promise<BrowserPushBinding>((resolve, reject) => {
    const open = indexedDB.open(BINDING_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(BINDING_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(BINDING_STORE, "readonly");
      const store = transaction.objectStore(BINDING_STORE);
      const read = store.get("owner");
      let owner: BrowserPushBinding = null;
      const accept = (value: unknown) => {
        if (value && typeof value === "object" && "user_id" in value && "endpoint" in value
          && typeof value.user_id === "number" && Number.isSafeInteger(value.user_id) && value.user_id > 0
          && typeof value.endpoint === "string") {
          owner = { user_id: Number(value.user_id), endpoint: value.endpoint };
        }
      };
      read.onsuccess = () => {
        if (read.result !== undefined) { accept(read.result); return; }
        // Existing installations stored only the active marker before enrollment persistence was introduced.
        const legacy = store.get("current");
        legacy.onsuccess = () => accept(legacy.result);
      };
      transaction.oncomplete = () => { db.close(); resolve(owner); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
}

/** Forget only the endpoint being removed, so a delayed cleanup cannot erase a newer owner. */
export function clearBrowserPushOwner(endpoint?: string): Promise<void> {
  const write = bindingQueue.catch(() => undefined).then(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(BINDING_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(BINDING_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(BINDING_STORE, "readwrite");
      const store = transaction.objectStore(BINDING_STORE);
      const read = store.get("owner");
      read.onsuccess = () => {
        if (!endpoint || read.result?.endpoint === endpoint) store.put(null, "owner");
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
  bindingQueue = write;
  return write;
}

export function pushSupport(): "supported" | "install_required" | "unsupported" {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (ios && !standalone) return "install_required";
  return window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
    ? "supported" : "unsupported";
}

export function decodePushPublicKey(publicKey: string): ArrayBuffer {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(decoded, char => char.charCodeAt(0)).buffer;
}

export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.find(registration =>
    [registration.active, registration.waiting, registration.installing].some(worker =>
      worker && new URL(worker.scriptURL).pathname === "/push-sw.js",
    ),
  ) || null;
}

export async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/", updateViaCache: "none" });
  if (registration.active && new URL(registration.active.scriptURL).pathname === "/push-sw.js"
    && registration.active.state === "activated") return registration;
  const worker = registration.installing || registration.waiting;
  if (!worker) throw new Error("הפעלת ההתראות לא הושלמה. אפשר לנסות שוב.");
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("הפעלת ההתראות מתעכבת. אפשר לנסות שוב.")), 15000);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      worker!.removeEventListener("statechange", changed);
      if (error) reject(error); else resolve();
    }
    function changed() {
      if (worker!.state === "activated") finish();
      if (worker!.state === "redundant") finish(new Error("הפעלת ההתראות לא הושלמה. אפשר לנסות שוב."));
    }
    worker.addEventListener("statechange", changed);
    changed();
  });
  return registration;
}

/** Suspend account delivery; retain opt-in enrollment on logout, remove it on account replacement. */
export async function detachBrowserPush({ serverCleanup = true, preserveSubscription = false }: {
  serverCleanup?: boolean;
  preserveSubscription?: boolean;
} = {}): Promise<void> {
  const cleanupToken = getToken();
  window.dispatchEvent(new Event(PUSH_DETACHING_EVENT));
  await setBrowserPushBinding(null).catch(() => undefined);
  const registration = await getPushRegistration().catch(() => null);
  if (!registration) return;
  const notifications = await registration.getNotifications().catch(() => []);
  notifications.forEach(notification => notification.close());
  // The worker's active marker is already empty: retained pushes are generic and cannot open an account item.
  if (preserveSubscription) return;
  const subscription = await registration.pushManager.getSubscription().catch(() => null);
  if (!subscription) { await clearBrowserPushOwner().catch(() => undefined); return; }
  let timeout: number | undefined;
  try {
    if (serverCleanup && cleanupToken) await Promise.race([
      api.pushUnsubscribe({ endpoint: subscription.endpoint }, cleanupToken),
      new Promise<void>(resolve => { timeout = window.setTimeout(resolve, 5000); }),
    ]);
  } catch {
    // Local unsubscription also disables this endpoint when the server is unreachable.
  } finally {
    window.clearTimeout(timeout);
    await subscription.unsubscribe().catch(() => false);
    await clearBrowserPushOwner(subscription.endpoint).catch(() => undefined);
  }
}
