#!/usr/bin/env bash
# שומר את תזרים חי באינטרנט — בלי localtunnel (חוסם דפדפנים / Tunnel busy).
# Primary: Cloudflare quick tunnel (trycloudflare.com)
# Backup:  localhost.run (lhr.life)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
URL_FILE="${ROOT}/.public-url"
URL_BACKUP_FILE="${ROOT}/.public-url-backup"
UV_LOG="${TMPDIR:-/tmp}/tazrim-uvicorn.log"
CF_LOG="${TMPDIR:-/tmp}/cloudflared.log"
LHR_LOG="${TMPDIR:-/tmp}/localhost-run.log"
KEEP_LOG="${TMPDIR:-/tmp}/tazrim-keepalive.log"
UV_PID_FILE="${TMPDIR:-/tmp}/tazrim-uvicorn.pid"
CF_PID_FILE="${TMPDIR:-/tmp}/tazrim-cloudflared.pid"
LHR_PID_FILE="${TMPDIR:-/tmp}/tazrim-lhr.pid"
BIN_DIR="${HOME}/.local/bin"
CLOUDFLARED="${BIN_DIR}/cloudflared"
CHECK_EVERY="${CHECK_EVERY:-8}"

export PATH="${BIN_DIR}:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$(dirname "$KEEP_LOG")" "$BIN_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$KEEP_LOG"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 14 \
    -H 'User-Agent: Mozilla/5.0 (compatible; tazrim-keepalive/3.0)' \
    -H 'Accept: text/html,application/json' \
    "$url" 2>/dev/null || echo "000"
}

# Browser-path check: HTML must be 200 (catches localtunnel interstitial / busy).
browser_ok() {
  local url="${1:-}"
  [[ -n "$url" ]] || return 1
  local code
  code="$(http_code "${url}/")"
  [[ "$code" == "200" ]]
}

health_ok() {
  local url="${1:-}"
  [[ -n "$url" ]] || return 1
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "${url}/health" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]]
}

public_ok() {
  browser_ok "$1" && health_ok "$1"
}

local_ok() {
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "http://${HOST}:${PORT}/health" 2>/dev/null || echo 000)" == "200" ]]
}

read_url() {
  local f="${1:-$URL_FILE}"
  [[ -f "$f" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$f"
}

ensure_cloudflared_bin() {
  if [[ -x "$CLOUDFLARED" ]]; then
    return 0
  fi
  log "מתקין cloudflared..."
  local ver
  ver="$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
  curl -fsSL -o "$CLOUDFLARED" \
    "https://github.com/cloudflare/cloudflared/releases/download/${ver}/cloudflared-linux-amd64"
  chmod +x "$CLOUDFLARED"
}

ensure_uvicorn() {
  if local_ok; then
    return 0
  fi
  log "uvicorn לא מגיב — מפעיל מחדש..."
  for pid in $(pgrep -f 'uvicorn app.main:app' || true); do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
    log "בונה frontend..."
    (cd "$ROOT/frontend" && npm ci && VITE_API_BASE_URL= npm run build) >>"$KEEP_LOG" 2>&1 || return 1
  fi
  (
    cd "$ROOT/backend"
    export PYTHONPATH="$ROOT/backend"
    export FRONTEND_DIST="$ROOT/frontend/dist"
    export INVESTMENTS_DB_PATH="${INVESTMENTS_DB_PATH:-$ROOT/backend/app/data/investments.db}"
    export APP_PUBLIC_URL="${APP_PUBLIC_URL:-http://localhost:${PORT}}"
    nohup uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >>"$UV_LOG" 2>&1 &
    echo $! >"$UV_PID_FILE"
  )
  for _ in $(seq 1 40); do
    local_ok && { log "uvicorn חי"; return 0; }
    sleep 0.5
  done
  return 1
}

start_cloudflare() {
  ensure_cloudflared_bin || return 1
  log "פותח מנהרת Cloudflare..."
  for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  # Stop localtunnel — it shows "Tunnel is busy" / interstitial to browsers
  for pid in $(pgrep -f 'localtunnel-open.js' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 2
  : >"$CF_LOG"
  nohup "$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate \
    >>"$CF_LOG" 2>&1 &
  echo $! >"$CF_PID_FILE"
  local cf_pid url=""
  cf_pid="$(cat "$CF_PID_FILE")"
  for _ in $(seq 1 50); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | tail -1 || true)"
    if [[ -n "$url" ]]; then
      break
    fi
    if ! kill -0 "$cf_pid" 2>/dev/null; then
      log "cloudflared נעצר מוקדם"
      tail -20 "$CF_LOG" | tee -a "$KEEP_LOG" || true
      return 1
    fi
    sleep 1
  done
  if [[ -z "$url" ]]; then
    log "לא התקבל קישור Cloudflare"
    return 1
  fi
  printf '%s\n' "$url" >"$URL_FILE"
  sleep 3
  if public_ok "$url"; then
    log "Cloudflare חי: $url"
    return 0
  fi
  sleep 4
  if public_ok "$url"; then
    log "Cloudflare חי (המתנה): $url"
    return 0
  fi
  log "Cloudflare נוצר אבל browser health נכשל: $url"
  return 1
}

start_lhr() {
  log "פותח מנהרת גיבוי localhost.run..."
  if [[ -f "$LHR_PID_FILE" ]]; then
    kill -9 "$(cat "$LHR_PID_FILE")" 2>/dev/null || true
  fi
  for pid in $(pgrep -f 'nokey@localhost.run' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
  : >"$LHR_LOG"
  nohup ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
    -R 80:localhost:${PORT} nokey@localhost.run >>"$LHR_LOG" 2>&1 &
  echo $! >"$LHR_PID_FILE"
  local url=""
  for _ in $(seq 1 35); do
    url="$(grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LHR_LOG" 2>/dev/null | tail -1 || true)"
    [[ -n "$url" ]] && break
    sleep 1
  done
  if [[ -z "$url" ]]; then
    log "לא התקבל קישור lhr.life"
    return 1
  fi
  printf '%s\n' "$url" >"$URL_BACKUP_FILE"
  sleep 2
  if public_ok "$url"; then
    log "גיבוי חי: $url"
    # If primary file empty or dead, promote backup for clients
    local primary
    primary="$(read_url "$URL_FILE")"
    if [[ -z "$primary" ]] || ! public_ok "$primary"; then
      printf '%s\n' "$url" >"$URL_FILE"
      log "מקדם גיבוי לקישור ראשי: $url"
    fi
    return 0
  fi
  sleep 3
  if public_ok "$url"; then
    log "גיבוי חי (המתנה): $url"
    return 0
  fi
  return 1
}

ensure_cloudflare() {
  local url
  url="$(read_url "$URL_FILE")"
  # If current primary is loca.lt — abandon it (browser-blocked)
  if [[ "$url" == *loca.lt* ]] || [[ "$url" == *localtunnel.me* ]]; then
    log "נוטשים localtunnel (חוסם דפדפן) — עוברים ל-Cloudflare/lhr"
    start_cloudflare || start_lhr
    return $?
  fi
  if ! pgrep -f '/cloudflared tunnel --url' >/dev/null 2>&1; then
    # Prefer keeping a healthy lhr primary if already promoted
    if [[ -n "$url" ]] && public_ok "$url"; then
      return 0
    fi
    start_cloudflare
    return $?
  fi
  if [[ -z "$url" ]] || ! public_ok "$url"; then
    log "Cloudflare לא בריא לדפדפן — מפעיל מחדש"
    start_cloudflare
    return $?
  fi
  return 0
}

ensure_lhr() {
  local url
  url="$(read_url "$URL_BACKUP_FILE")"
  if ! pgrep -f 'nokey@localhost.run' >/dev/null 2>&1; then
    start_lhr
    return $?
  fi
  if [[ -z "$url" ]] || ! public_ok "$url"; then
    log "גיבוי lhr לא בריא — מפעיל מחדש"
    start_lhr
    return $?
  fi
  return 0
}

log "===== keep-public-alive v4 (cloudflare+lhr, browser checks) ====="

LOCK="/tmp/tazrim-keepalive.lock"
if [[ -f "$LOCK" ]]; then
  old_pid="$(cat "$LOCK" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null && [[ "$old_pid" != "$$" ]]; then
    log "מחליף keepalive ישן (pid $old_pid)"
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

# Drop localtunnel immediately
for pid in $(pgrep -f 'localtunnel-open.js' || true); do
  kill -9 "$pid" 2>/dev/null || true
done

while true; do
  ensure_uvicorn || true
  ensure_cloudflare || true
  ensure_lhr || true
  sleep "$CHECK_EVERY"
done
