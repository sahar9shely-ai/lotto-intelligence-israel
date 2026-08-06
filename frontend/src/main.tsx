import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const CACHE_BUST = "tazrim-v7-20260806-nosw";

async function purgeStale() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
}

async function bootstrap() {
  const prev = localStorage.getItem("tazrim-cache-bust");
  if (prev !== CACHE_BUST) {
    localStorage.setItem("tazrim-cache-bust", CACHE_BUST);
    await purgeStale();
  } else if ("serviceWorker" in navigator) {
    // Keep killing any resurrected SW from old builds
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );

  // Register killer SW once so old clients purge themselves, then never re-register a caching SW.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(`/sw.js?v=${CACHE_BUST}`)
        .then((reg) => {
          // After activate unregisters itself; no ongoing control needed.
          window.setTimeout(() => {
            void reg.unregister();
          }, 5000);
        })
        .catch(() => {
          /* optional */
        });
    });
  }
}

void bootstrap();
