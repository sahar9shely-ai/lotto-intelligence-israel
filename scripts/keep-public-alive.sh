#!/usr/bin/env bash
# Public tunnel keepalive v10 — STABILITY FIRST.
# Never thrash a working URL. Cloudflare primary, lhr fallback.
# Health = /health JSON ok OR SPA HTML. Grace period after connect.
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
CF_PID_FILE="/tmp/tazrim-cf.pid"
LHR_PID_FILE="/tmp/tazrim-lhr.pid"
GRACE_UNTIL=0

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$(dirname "$KEEP_LOG")"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$KEEP_LOG"; }

now() { date +%s; }

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

# DNS dead (NXDOMAIN) → treat as hard fail for fast reconnect.
dns_ok() {
  local host="$1"
  host="${host#https://}"
  host="${host%%/*}"
  getent hosts "$host" >/dev/null 2>&1 || host "$host" >/dev/null 2>&1
}

# True if the public URL serves our app (HTML or health JSON).
browser_ok() {
  local url="$1"
  local code body hcode host
  host="${url#https://}"
  host="${host%%/*}"
  if ! dns_ok "$host"; then
    return 1
  fi
  # Prefer health — stable and not blocked by interstitial pages
  hcode="$(curl -sS -o /tmp/tazrim-pub-health.json -w '%{http_code}' --max-time 12 \
    -H 'User-Agent: Mozilla/5.0' "${url}/health" 2>/dev/null || echo 000)"
  if [[ "$hcode" == "200" ]] && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' /tmp/tazrim-pub-health.json 2>/dev/null; then
    # Also require root is not "no tunnel here"
    code="$(curl -sS -o /tmp/tazrim-pub-check.html -w '%{http_code}' --max-time 12 \
      -H 'User-Agent: Mozilla/5.0' -H 'Accept: text/html' "${url}/" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      body="$(cat /tmp/tazrim-pub-check.html 2>/dev/null || true)"
      echo "$body" | grep -Eqi 'no tunnel here|Tunnel is busy|Tunnel Unavailable|Tunnel website ahead' && return 1
      return 0
    fi
  fi
  return 1
}

publish_url() {
  local url="$1"
  printf '%s\n' "$url" >"$URL_FILE"
  printf '%s\n' "$url" >"$BACKUP_FILE"
  GRACE_UNTIL=$(( $(now) + 120 ))
  log "קישור פעיל: $url (grace 120s)"
}

current_url() {
  [[ -f "$URL_FILE" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$URL_FILE"
}

# Kill ALL cloudflared quick tunnels (by matching binary+args carefully via pgrep -f on unique string)
kill_all_cf() {
  local pids
  pids="$(pgrep -f 'cloudflared tunnel --url http://127.0.0.1:' || true)"
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
  done
  rm -f "$CF_PID_FILE"
}

kill_all_lhr() {
  local pids
  pids="$(pgrep -f 'nokey@localhost.run' || true)"
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
  done
  rm -f "$LHR_PID_FILE"
}

kill_localtunnel() {
  local pids
  pids="$(pgrep -f 'localtunnel-open.js' || true)"
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
  done
}

tunnel_proc_alive_for_url() {
  local url="$1"
  if [[ "$url" == *.trycloudflare.com ]]; then
    pgrep -f 'cloudflared tunnel --url http://127.0.0.1:' >/dev/null 2>&1
  elif [[ "$url" == *.lhr.life ]]; then
    pgrep -f 'nokey@localhost.run' >/dev/null 2>&1
  else
    return 0
  fi
}

open_cloudflare() {
  command -v cloudflared >/dev/null 2>&1 || return 1
  kill_all_cf
  sleep 2
  : >"$CF_LOG"
  nohup cloudflared tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate \
    >"$CF_LOG" 2>&1 &
  local cf_pid=$!
  echo "$cf_pid" >"$CF_PID_FILE"
  local url=""
  for _ in $(seq 1 55); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | tail -1 || true)"
    [[ -n "$url" ]] && break
    kill -0 "$cf_pid" 2>/dev/null || return 1
    sleep 1
  done
  [[ -n "$url" ]] || return 1
  sleep 8
  for _ in $(seq 1 40); do
    if browser_ok "$url"; then
      kill_all_lhr
      kill_localtunnel
      # Ensure only this CF remains
      for pid in $(pgrep -f 'cloudflared tunnel --url http://127.0.0.1:' || true); do
        if [[ "$pid" != "$cf_pid" ]]; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
      publish_url "$url"
      return 0
    fi
    sleep 2
  done
  log "cloudflare נוצר אבל לא עבר בדיקה: $url"
  kill -9 "$cf_pid" 2>/dev/null || true
  return 1
}

open_lhr() {
  kill_all_lhr
  sleep 1
  : >"$LHR_LOG"
  nohup ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=5 -o ExitOnForwardFailure=yes \
    -R 80:localhost:${PORT} nokey@localhost.run >>"$LHR_LOG" 2>&1 &
  local ssh_pid=$!
  echo "$ssh_pid" >"$LHR_PID_FILE"
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
      publish_url "$url"
      return 0
    fi
    sleep 2
  done
  log "lhr נוצר אבל לא עבר בדיקה: $url"
  return 1
}

reconnect() {
  log "מנהרה לא בריאה — מחבר מחדש (cloudflare)"
  if open_cloudflare; then
    return 0
  fi
  log "cloudflare נכשל — מנסה localhost.run"
  kill_all_cf
  open_lhr
}

# --- main ---
if [[ -f "$LOCK" ]]; then
  old="$(cat "$LOCK" 2>/dev/null || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null && [[ "$old" != "$$" ]]; then
    kill "$old" 2>/dev/null || true
    sleep 1
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

kill_localtunnel

log "===== keep-public-alive v10 (anti-thrash) ====="

ensure_uvicorn || true
url="$(current_url)"
if [[ -n "$url" ]] && tunnel_proc_alive_for_url "$url" && browser_ok "$url"; then
  GRACE_UNTIL=$(( $(now) + 120 ))
  log "שומר קישור קיים ובריא: $url"
else
  reconnect || true
fi

STABLE_FAILS=0
while true; do
  ensure_uvicorn || true
  url="$(current_url)"

  # During grace — never reconnect
  if [[ $(now) -lt $GRACE_UNTIL ]]; then
    sleep 15
    continue
  fi

  if [[ -n "$url" ]] && tunnel_proc_alive_for_url "$url" && browser_ok "$url"; then
    STABLE_FAILS=0
    sleep 40
    continue
  fi

  # NXDOMAIN / process dead → reconnect immediately (don't leave users on dead bookmarks)
  host="${url#https://}"; host="${host%%/*}"
  if [[ -z "$url" ]] || ! tunnel_proc_alive_for_url "$url" || ! dns_ok "$host"; then
    log "מנהרה מתה (DNS/תהליך) — מחבר מחדש מיד"
    reconnect || sleep 15
    STABLE_FAILS=0
    sleep 15
    continue
  fi

  STABLE_FAILS=$((STABLE_FAILS + 1))
  # Soft failures: need 3 consecutive before reconnect
  if [[ "$STABLE_FAILS" -lt 3 ]]; then
    log "בדיקת מנהרה נכשלה פעם ${STABLE_FAILS}/3 — לא מחליפים עדיין"
    sleep 20
    continue
  fi
  reconnect || sleep 20
  STABLE_FAILS=0
  sleep 20
done
