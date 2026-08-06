#!/usr/bin/env node
/**
 * Public tunnel via localtunnel — ALWAYS uses the fixed subdomain.
 * Never falls back to a random URL (that breaks the user's bookmark).
 * Prints: url=<https://...>
 */
const path = require("path");
if (process.env.NODE_PATH) {
  for (const p of process.env.NODE_PATH.split(path.delimiter).filter(Boolean)) {
    module.paths.unshift(p);
  }
}
const localtunnel = require("localtunnel");

const port = Number(process.env.PORT || 8000);
const preferred = process.env.TUNNEL_SUBDOMAIN || "tazrim-sahar";
const expectedHost = `${preferred}.loca.lt`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openPreferred() {
  const tunnel = await localtunnel({ port, subdomain: preferred });
  const url = tunnel.url || "";
  const host = url.replace(/^https?:\/\//, "").split("/")[0];
  if (host !== expectedHost && host !== `${preferred}.localtunnel.me`) {
    try {
      tunnel.close();
    } catch (_) {}
    throw new Error(`got_wrong_host=${host}; expected=${expectedHost}`);
  }
  return tunnel;
}

(async () => {
  let tunnel = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      tunnel = await openPreferred();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.error(`attempt=${attempt} err=${e}`);
      await sleep(1500 * attempt);
    }
  }
  if (!tunnel) {
    console.error("fail=" + lastErr);
    process.exit(1);
  }

  const url = tunnel.url;
  console.log("url=" + url);

  const shutdown = () => {
    try {
      tunnel.close();
    } catch (_) {}
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  tunnel.on("error", (err) => {
    console.error("tunnel_error=" + err);
  });
  tunnel.on("close", () => {
    console.error("tunnel_closed");
    process.exit(1);
  });
  setInterval(() => {}, 60_000);
})().catch((e) => {
  console.error("fail=" + e);
  process.exit(1);
});
