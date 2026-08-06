#!/usr/bin/env node
/**
 * Stable public tunnel via localtunnel with preferred subdomain.
 * Prints: url=<https://...>
 * Keeps process alive until SIGTERM/SIGINT.
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

async function openOnce(subdomain) {
  const opts = { port };
  if (subdomain) opts.subdomain = subdomain;
  const tunnel = await localtunnel(opts);
  return tunnel;
}

(async () => {
  let tunnel;
  try {
    tunnel = await openOnce(preferred);
  } catch (e) {
    console.error("preferred_subdomain_failed=" + e);
    tunnel = await openOnce(undefined);
  }

  const url = tunnel.url;
  if (!url) {
    console.error("no_url");
    process.exit(1);
  }
  console.log("url=" + url);
  process.stdout.write("", () => {});

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
  // Keep event loop alive
  setInterval(() => {}, 60_000);
})().catch((e) => {
  console.error("fail=" + e);
  process.exit(1);
});
