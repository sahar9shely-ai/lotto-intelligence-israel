import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const CACHE_BUST = "tazrim-v13-homescreen-logo-a-20260915";

async function purgeStale() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    await removeLegacyWorkers();
  } catch {
    /* ignore */
  }
}

async function removeLegacyWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(registrations.map(registration => {
    const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
    const hasPushWorker = workers.some(worker => new URL(worker!.scriptURL).pathname === "/push-sw.js");
    const hasLegacyWorker = workers.some(worker => new URL(worker!.scriptURL).pathname === "/sw.js");
    return hasLegacyWorker && !hasPushWorker ? registration.unregister() : Promise.resolve(false);
  }));
}

async function bootstrap() {
  const prev = localStorage.getItem("tazrim-cache-bust");
  if (prev !== CACHE_BUST) {
    localStorage.setItem("tazrim-cache-bust", CACHE_BUST);
    await purgeStale();
  } else {
    await removeLegacyWorkers();
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );

}

void bootstrap();
