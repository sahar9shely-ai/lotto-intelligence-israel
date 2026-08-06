#!/usr/bin/env bash
# Public tunnel keepalive v8 — localhost.run primary (proven in this env).
# Cloudflare quick tunnel is tried only if lhr fails repeatedly.
# Rewrite .public-url only after browser HTML check. Avoid thrashing.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
URL_FILE="${ROOT}/.public-url"
BACKUP_FILE="${ROOT}/.public-url-backup"
CF_LOG="${TMPDIR:-/tmp}/tazrim-cloudflared.log"
LHR_LOG="${TMPDIR:-/tmp}/localhost-run.log"
KEEP_LOG="${TMPDIR:-/tmp}/tazrim-keepalive.log"
UV_LOG="${TMPDIR:-/tmp}/tazrim-uvicorn.log"
LOCK="/tmp/tazrim-keepalive.lock"

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$(dirname "$KEEP_LOG")"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$KEEP_LOG"; }

local_spa_ok() {
  local code
  code="$(curl -sS -o /tmp/tazrim-root-check.html -w '%{http_code}' --max-time 4 "http://${HOST}:${PORT}/" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]] || return 1
  grep -Eqi '<!doctype html>|תזרים' /tmp/tazrim-root-check.html 2>/dev/null
}

ensure_uvicorn() {
  if curl -sf --max-time 3 "http://${HOST}:${PORT}/health" >/dev/null 2>&1 && local_spa_ok; then
    return 0
  fi
  log "מפעיל uvicorn + SPA..."
  # Kill by matching python uvicorn cmdline carefully
  for pid in $(pgrep -f '/.local/bin/uvicorn app.main:app' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
  if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
    (cd "$ROOT/frontend" && npm ci && VITE_API_BASE_URL= npm run build) >>"$KEEP_LOG" 2>&1 || return 1
  fi
  (
    cd "$ROOT/backend"
    export PYTHONPATH="$ROOT/backend"
    export FRONTEND_DIST="$ROOT/frontend/dist"
    export INVESTMENTS_DB_PATH="${INVESTMENTS_DB_PATH:-$ROOT/backend/app/data/investments.db}"
    nohup uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >>"$UV_LOG" 2>&1 &
  )
  for _ in $(seq 1 50); do
    local_spa_ok && curl -sf --max-time 3 "http://${HOST}:${PORT}/health" >/dev/null 2>&1 && return 0
    sleep 0.4
  done
  return 1
}

browser_ok() {
  local url="$1"
  local code body
  code="$(curl -sS -o /tmp/tazrim-pub-check.html -w '%{http_code}' --max-time 16 \
    -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' \
    -H 'Accept: text/html' "${url}/" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]] || return 1
  body="$(cat /tmp/tazrim-pub-check.html 2>/dev/null || true)"
  echo "$body" | grep -Eqi 'no tunnel here|Tunnel is busy|Tunnel Unavailable|Error 1033' && return 1
  echo "$body" | grep -Eqi '<!doctype html>|תזרים'
}

publish_url() {
  local url="$1"
  local prev
  prev="$(current_url)"
  printf '%s\n' "$url" >"$URL_FILE"
  printf '%s\n' "$url" >"$BACKUP_FILE"
  if [[ "$prev" == "$url" ]]; then
    log "קישור פעיל (אותו): $url"
  else
    log "קישור פעיל: $url"
  fi
}

current_url() {
  [[ -f "$URL_FILE" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$URL_FILE"
}

stop_cloudflare() {
  for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
}

stop_lhr() {
  for pid in $(pgrep -f 'nokey@localhost.run' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
}

open_lhr() {
  stop_lhr
  sleep 1
  : >"$LHR_LOG"
  nohup ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=4 -o ExitOnForwardFailure=yes \
    -R 80:localhost:${PORT} nokey@localhost.run >>"$LHR_LOG" 2>&1 &
  local ssh_pid=$!
  echo "$ssh_pid" > /tmp/tazrim-lhr.pid
  local url=""
  for _ in $(seq 1 45); do
    url="$(grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LHR_LOG" 2>/dev/null | tail -1 || true)"
    [[ -n "$url" ]] && break
    kill -0 "$ssh_pid" 2>/dev/null || return 1
    sleep 1
  done
  [[ -n "$url" ]] || return 1
  for _ in $(seq 1 25); do
    if browser_ok "$url"; then
      stop_cloudflare
      publish_url "$url"
      return 0
    fi
    sleep 2
  done
  log "lhr נוצר אבל לא עבר בדיקה: $url"
  return 1
}

open_cloudflare() {
  command -v cloudflared >/dev/null 2>&1 || return 1
  stop_cloudflare
  sleep 1
  : >"$CF_LOG"
  nohup cloudflared tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate \
    >"$CF_LOG" 2>&1 &
  local cf_pid=$!
  echo "$cf_pid" > /tmp/tazrim-cf.pid
  local url=""
  for _ in $(seq 1 50); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | tail -1 || true)"
    [[ -n "$url" ]] && break
    kill -0 "$cf_pid" 2>/dev/null || return 1
    sleep 1
  done
  [[ -n "$url" ]] || return 1
  # DNS + edge warm-up can take a while
  for _ in $(seq 1 30); do
    if browser_ok "$url"; then
      stop_lhr
      publish_url "$url"
      return 0
    fi
    sleep 2
  done
  log "cloudflare נוצר אבל לא עבר בדיקה: $url"
  stop_cloudflare
  return 1
}

reconnect() {
  log "מנהרה לא בריאה — מחבר מחדש (lhr)"
  if open_lhr; then
    return 0
  fi
  log "lhr נכשל — מנסה cloudflare"
  open_cloudflare
}

if [[ -f "$LOCK" ]]; then
  old="$(cat "$LOCK" 2>/dev/null || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null && [[ "$old" != "$$" ]]; then
    kill "$old" 2>/dev/null || true
    sleep 1
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

# Stop competing localtunnel (browser interstitial / 511)
for pid in $(pgrep -f 'localtunnel-open.js' || true); do kill -9 "$pid" 2>/dev/null || true; done

log "===== keep-public-alive v8 (lhr primary) ====="

STABLE_FAILS=0
while true; do
  ensure_uvicorn || true
  url="$(current_url)"
  # Also require the ssh process if URL is lhr
  alive_proc=1
  if [[ "$url" == *.lhr.life ]]; then
    pgrep -f 'nokey@localhost.run' >/dev/null 2>&1 || alive_proc=0
  elif [[ "$url" == *.trycloudflare.com ]]; then
    pgrep -f '/cloudflared tunnel --url' >/dev/null 2>&1 || alive_proc=0
  fi

  if [[ -n "$url" ]] && [[ "$alive_proc" -eq 1 ]] && browser_ok "$url"; then
    STABLE_FAILS=0
    sleep 20
    continue
  fi
  STABLE_FAILS=$((STABLE_FAILS + 1))
  # 3 consecutive failures before reconnect (reduce URL thrash)
  if [[ "$STABLE_FAILS" -lt 3 ]]; then
    log "בדיקת מנהרה נכשלה פעם ${STABLE_FAILS}/3 — ממתין"
    sleep 8
    continue
  fi
  reconnect || sleep 10
  STABLE_FAILS=0
  sleep 10
done
