import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const CACHE_BUST = "tazrim-v3-20260805";

async function bootstrap() {
  if (localStorage.getItem("tazrim-cache-bust") !== CACHE_BUST) {
    localStorage.setItem("tazrim-cache-bust", CACHE_BUST);
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
    window.location.reload();
    return;
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register(`/sw.js?v=${CACHE_BUST}`).catch(() => {
        /* offline cache optional */
      });
    });
  }
}

void bootstrap();
