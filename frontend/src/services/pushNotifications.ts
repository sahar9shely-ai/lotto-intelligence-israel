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
      transaction.objectStore(BINDING_STORE).put(binding, "current");
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

/** Clear local delivery first, then remove the authenticated server binding before logout. */
export async function detachBrowserPush({ serverCleanup = true }: { serverCleanup?: boolean } = {}): Promise<void> {
  const cleanupToken = getToken();
  window.dispatchEvent(new Event(PUSH_DETACHING_EVENT));
  await setBrowserPushBinding(null).catch(() => undefined);
  const registration = await getPushRegistration().catch(() => null);
  if (!registration) return;
  const notifications = await registration.getNotifications().catch(() => []);
  notifications.forEach(notification => notification.close());
  const subscription = await registration.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
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
  }
}
