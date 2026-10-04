/* Push delivery only. No fetch handler, offline pages, authentication token, or financial cache. */
const BINDING_DB = "tazrim-push-binding";
const BINDING_STORE = "binding";

function readBinding() {
  return new Promise((resolve) => {
    const open = indexedDB.open(BINDING_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(BINDING_STORE);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(BINDING_STORE, "readonly");
      const request = transaction.objectStore(BINDING_STORE).get("current");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); resolve(null); };
    };
  });
}

function safeNotificationUrl(href) {
  try {
    const url = new URL(typeof href === "string" ? href : "/", self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || !["https:", "http:"].includes(url.protocol)) return self.location.origin + "/";
    // Allow application destinations and their identifying filters only, never tokens or arbitrary query data.
    if (!["/", "/payments", "/investors", "/activity", "/account"].includes(url.pathname) && !/^\/agreements\/\d+\/sign$/.test(url.pathname)) return self.location.origin + "/";
    const target = new URL(url.pathname, self.location.origin);
    for (const key of ["investor_id", "payment_id", "agreement_id", "topup_request_id", "year"]) {
      const value = url.searchParams.get(key);
      if (value && /^\d+$/.test(value)) target.searchParams.set(key, value);
    }
    if (url.searchParams.get("section") === "documents") target.searchParams.set("section", "documents");
    const month = url.searchParams.get("month");
    if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) target.searchParams.set("month", month);
    return target.href;
  } catch { return self.location.origin + "/"; }
}

async function bindingMatches(userId) {
  const binding = await readBinding();
  if (!binding || !Number.isInteger(userId) || binding.user_id !== userId) return false;
  const subscription = await self.registration.pushManager.getSubscription();
  return Boolean(subscription && subscription.endpoint === binding.endpoint);
}

function notificationBody(kind) {
  // Use reviewed, non-identifying copy only. Never render arbitrary payload text
  // or financial/account details on a shared device's lock screen.
  switch (kind) {
    case "test": return "זו התראת בדיקה מתזרים.";
    case "admin_login": return "משקיע התחבר לתזרים. אפשר לפתוח את המעקב לפרטים.";
    case "agreement_reminder":
    case "topup_reminder": return "ממתין לך הסכם לחתימה. אפשר לפתוח את תזרים ולחתום.";
    case "agreement":
    case "topup": return "ממתין לך מסמך לאישור ולחתימה. אפשר לפתוח את תזרים.";
    case "payment": return "ממתינה לך בקשה לאישור קבלת תשלום. אפשר לפתוח את תזרים.";
    default: return "יש בקשת אישור חדשה בתזרים. פתחו את האפליקציה כדי לצפות בה.";
  }
}

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { payload = null; }
    const ownerId = payload?.data?.owner_user_id;
    const matches = payload && await bindingMatches(ownerId).catch(() => false);
    await self.registration.showNotification("תזרים", {
      body: matches ? notificationBody(payload.kind) : "פתחו את תזרים כדי לבדוק אם ממתינה בקשת אישור.",
      icon: "/icon-192-logo-a.png",
      badge: "/icon-192-logo-a.png",
      tag: matches && typeof payload.tag === "string" && /^tazrim-push-\d+$/.test(payload.tag) ? payload.tag : "tazrim-pending-request",
      data: matches ? { url: safeNotificationUrl(payload.data.href), user_id: ownerId } : {},
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    if (!data || !(await bindingMatches(data.user_id).catch(() => false))) return;
    const target = safeNotificationUrl(data.url);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); await existing.focus(); }
    else await self.clients.openWindow(target);
  })());
});
