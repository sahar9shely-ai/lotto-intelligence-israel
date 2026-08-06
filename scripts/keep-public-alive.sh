#!/usr/bin/env bash
# שומר תזרים באינטרנט. כותב ל־.public-url רק קישור שעובד בדפדפן.
# Primary preference: localhost.run (lhr) — אמין יותר לדפדפן כאן
# Secondary: Cloudflare quick tunnel
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
CHECK_EVERY="${CHECK_EVERY:-10}"

export PATH="${BIN_DIR}:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$(dirname "$KEEP_LOG")" "$BIN_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$KEEP_LOG"
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 14 \
    -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' \
    -H 'Accept: text/html,application/json' \
    "$1" 2>/dev/null || echo "000"
}

public_ok() {
  local url="${1:-}"
  [[ -n "$url" ]] || return 1
  local code body
  # Prefer SPA HTML, but accept /health 200 while HTML catches up.
  code="$(http_code "${url}/")"
  if [[ "$code" == "200" ]]; then
    body="$(curl -sS --max-time 14 -H 'User-Agent: Mozilla/5.0' -H 'Accept: text/html' "${url}/" 2>/dev/null || true)"
    if echo "$body" | grep -Eqi 'no tunnel here|Tunnel is busy|Tunnel Unavailable|Tunnel website ahead'; then
      return 1
    fi
    if echo "$body" | grep -Eqi 'תזרים|tazrim|<!doctype html'; then
      return 0
    fi
  fi
  local hc
  hc="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "${url}/health" 2>/dev/null || echo 000)"
  [[ "$hc" == "200" ]] || return 1
  # Health alone is not enough if root is an explicit tunnel-error page
  if [[ "$code" == "503" || "$code" == "502" || "$code" == "000" ]]; then
    return 1
  fi
  return 0
}

local_ok() {
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "http://${HOST}:${PORT}/health" 2>/dev/null || echo 000)" == "200" ]]
}

read_url() {
  local f="${1:-$URL_FILE}"
  [[ -f "$f" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$f"
}

set_primary_url() {
  local url="$1"
  printf '%s\n' "$url" >"$URL_FILE"
  log "קישור ראשי פעיל: $url"
}

ensure_cloudflared_bin() {
  [[ -x "$CLOUDFLARED" ]] && return 0
  local ver
  ver="$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
  curl -fsSL -o "$CLOUDFLARED" \
    "https://github.com/cloudflare/cloudflared/releases/download/${ver}/cloudflared-linux-amd64"
  chmod +x "$CLOUDFLARED"
}

ensure_uvicorn() {
  if local_ok; then
    # Also ensure SPA is mounted (health alone is not enough for browsers).
    local root_code
    root_code="$(curl -sS -o /tmp/tazrim-root-check.html -w '%{http_code}' --max-time 4 "http://${HOST}:${PORT}/" 2>/dev/null || echo 000)"
    if [[ "$root_code" == "200" ]] && grep -Eqi '<!doctype html>|תזרים' /tmp/tazrim-root-check.html 2>/dev/null; then
      return 0
    fi
    log "uvicorn חי אבל ה־SPA לא מוגש (/ → ${root_code}) — מפעיל מחדש עם FRONTEND_DIST"
  else
    log "uvicorn לא מגיב — מפעיל מחדש..."
  fi
  for pid in $(pgrep -f '/.local/bin/uvicorn app.main:app' || true); do
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
  for _ in $(seq 1 50); do
    if local_ok; then
      root_code="$(curl -sS -o /tmp/tazrim-root-check.html -w '%{http_code}' --max-time 4 "http://${HOST}:${PORT}/" 2>/dev/null || echo 000)"
      if [[ "$root_code" == "200" ]] && grep -Eqi '<!doctype html>|תזרים' /tmp/tazrim-root-check.html 2>/dev/null; then
        log "uvicorn + SPA חיים"
        return 0
      fi
    fi
    sleep 0.5
  done
  log "uvicorn/SPA לא עלו בזמן"
  return 1
}

start_lhr() {
  log "פותח localhost.run..."
  if [[ -f "$LHR_PID_FILE" ]]; then kill -9 "$(cat "$LHR_PID_FILE")" 2>/dev/null || true; fi
  for pid in $(pgrep -f 'nokey@localhost.run' || true); do kill -9 "$pid" 2>/dev/null || true; done
  sleep 1
  : >"$LHR_LOG"
  nohup ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ExitOnForwardFailure=yes \
    -R 80:localhost:${PORT} nokey@localhost.run >>"$LHR_LOG" 2>&1 &
  echo $! >"$LHR_PID_FILE"
  local url=""
  for _ in $(seq 1 40); do
    url="$(grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LHR_LOG" 2>/dev/null | tail -1 || true)"
    [[ -n "$url" ]] && break
    sleep 1
  done
  [[ -n "$url" ]] || { log "לא התקבל lhr"; return 1; }
  printf '%s\n' "$url" >"$URL_BACKUP_FILE"
  sleep 2
  if public_ok "$url"; then
    set_primary_url "$url"
    return 0
  fi
  sleep 4
  if public_ok "$url"; then
    set_primary_url "$url"
    return 0
  fi
  log "lhr נוצר אבל לא עבר בדיקת דפדפן: $url"
  return 1
}

start_cloudflare() {
  ensure_cloudflared_bin || return 1
  log "פותח Cloudflare (גיבוי)..."
  for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do kill -9 "$pid" 2>/dev/null || true; done
  sleep 2
  : >"$CF_LOG"
  nohup "$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate \
    >>"$CF_LOG" 2>&1 &
  echo $! >"$CF_PID_FILE"
  local cf_pid url=""
  cf_pid="$(cat "$CF_PID_FILE")"
  for _ in $(seq 1 55); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | tail -1 || true)"
    [[ -n "$url" ]] && break
    kill -0 "$cf_pid" 2>/dev/null || { log "cloudflared נעצר"; return 1; }
    sleep 1
  done
  [[ -n "$url" ]] || return 1
  # Wait for DNS / edge — do NOT overwrite primary until healthy
  for _ in $(seq 1 20); do
    if public_ok "$url"; then
      printf '%s\n' "$url" >"$URL_BACKUP_FILE"
      # Only promote if primary missing/dead
      local primary
      primary="$(read_url "$URL_FILE")"
      if [[ -z "$primary" ]] || ! public_ok "$primary"; then
        set_primary_url "$url"
      else
        log "Cloudflare חי כגיבוי: $url (ראשי נשאר $primary)"
      fi
      return 0
    fi
    sleep 2
  done
  log "Cloudflare לא עבר בדיקת דפדפן — לא מחליפים קישור ראשי ($url)"
  return 1
}

ensure_primary() {
  local primary
  primary="$(read_url "$URL_FILE")"
  if [[ -n "$primary" ]] && public_ok "$primary"; then
    return 0
  fi
  log "אין קישור ראשי בריא — מפעיל localhost.run"
  start_lhr && return 0
  log "lhr נכשל — מנסה Cloudflare"
  start_cloudflare
}

ensure_backup_processes() {
  # Keep lhr process if primary is lhr
  local primary backup
  primary="$(read_url "$URL_FILE")"
  backup="$(read_url "$URL_BACKUP_FILE")"

  if [[ "$primary" == *.lhr.life ]]; then
    if ! pgrep -f 'nokey@localhost.run' >/dev/null 2>&1; then
      start_lhr || true
    fi
  fi

  # Optional CF backup — only if primary not already CF and CF missing
  if [[ "$primary" != *trycloudflare.com ]]; then
    if ! pgrep -f '/cloudflared tunnel --url' >/dev/null 2>&1; then
      start_cloudflare || true
    fi
  fi

  # If backup URL died but primary ok — refresh backup quietly without touching primary
  if [[ -n "$backup" && "$backup" != "$primary" ]] && ! public_ok "$backup"; then
    :
  fi
}

# Stop localtunnel leftovers
for pid in $(pgrep -f 'localtunnel-open.js' || true); do kill -9 "$pid" 2>/dev/null || true; done

log "===== keep-public-alive v5 (lhr primary, no URL overwrite on fail) ====="

LOCK="/tmp/tazrim-keepalive.lock"
if [[ -f "$LOCK" ]]; then
  old_pid="$(cat "$LOCK" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null && [[ "$old_pid" != "$$" ]]; then
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

while true; do
  ensure_uvicorn || true
  ensure_primary || true
  ensure_backup_processes || true
  sleep "$CHECK_EVERY"
done
