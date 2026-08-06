#!/usr/bin/env bash
# שומר את תזרים חי באינטרנט עם שתי מנהרות + בדיקה מהירה.
# Primary: localtunnel (כתובת קבועה tazrim-sahar.loca.lt)
# Backup:  localhost.run (lhr.life) — מתחלף בכל חיבור מחדש
#
# Usage:
#   nohup ./scripts/keep-public-alive.sh >/tmp/tazrim-keepalive.out 2>&1 &
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
URL_FILE="${ROOT}/.public-url"
URL_BACKUP_FILE="${ROOT}/.public-url-backup"
UV_LOG="${TMPDIR:-/tmp}/tazrim-uvicorn.log"
LT_LOG="${TMPDIR:-/tmp}/localtunnel.log"
LHR_LOG="${TMPDIR:-/tmp}/localhost-run.log"
KEEP_LOG="${TMPDIR:-/tmp}/tazrim-keepalive.log"
UV_PID_FILE="${TMPDIR:-/tmp}/tazrim-uvicorn.pid"
LT_PID_FILE="${TMPDIR:-/tmp}/tazrim-localtunnel.pid"
LHR_PID_FILE="${TMPDIR:-/tmp}/tazrim-lhr.pid"
LT_DIR="${TMPDIR:-/tmp}/tazrim-lt"
CHECK_EVERY="${CHECK_EVERY:-5}"
TUNNEL_SUBDOMAIN="${TUNNEL_SUBDOMAIN:-tazrim-sahar}"

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$(dirname "$KEEP_LOG")" "$LT_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$KEEP_LOG"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 12 \
    -H 'bypass-tunnel-reminder: 1' \
    -H 'User-Agent: Mozilla/5.0 (compatible; tazrim-keepalive/2.0)' \
    "$url" 2>/dev/null || echo "000"
}

local_ok() {
  [[ "$(http_code "http://${HOST}:${PORT}/health")" == "200" ]]
}

public_ok() {
  local url="${1:-}"
  [[ -n "$url" ]] || return 1
  local code
  code="$(http_code "${url}/health")"
  [[ "$code" == "200" ]]
}

read_url() {
  local f="${1:-$URL_FILE}"
  [[ -f "$f" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$f"
}

ensure_localtunnel_pkg() {
  if [[ -f "$LT_DIR/node_modules/localtunnel/package.json" ]]; then
    return 0
  fi
  log "מתקין localtunnel..."
  mkdir -p "$LT_DIR"
  if [[ ! -f "$LT_DIR/package.json" ]]; then
    printf '%s\n' '{"name":"tazrim-lt","private":true}' >"$LT_DIR/package.json"
  fi
  (cd "$LT_DIR" && npm install --silent localtunnel@2.0.2) >>"$KEEP_LOG" 2>&1 || {
    log "התקנת localtunnel נכשלה"
    return 1
  }
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
    (cd "$ROOT/frontend" && npm ci && VITE_API_BASE_URL= npm run build) >>"$KEEP_LOG" 2>&1 || {
      log "בניית frontend נכשלה"
      return 1
    }
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
    if local_ok; then
      log "uvicorn חי"
      return 0
    fi
    sleep 0.5
  done
  log "uvicorn לא עלה בזמן"
  return 1
}

kill_pids_matching() {
  local pattern="$1"
  for pid in $(pgrep -f "$pattern" || true); do
    # Never kill ourselves / parent shells by matching keepalive script name alone here
    kill -9 "$pid" 2>/dev/null || true
  done
}

start_localtunnel() {
  ensure_localtunnel_pkg || return 1
  log "פותח localtunnel (subdomain=${TUNNEL_SUBDOMAIN})..."
  kill_pids_matching 'localtunnel-open.js'
  if [[ -f "$LT_PID_FILE" ]]; then
    kill -9 "$(cat "$LT_PID_FILE")" 2>/dev/null || true
  fi
  sleep 1
  : >"$LT_LOG"
  (
    cd "$LT_DIR"
    export PORT TUNNEL_SUBDOMAIN
    export NODE_PATH="$LT_DIR/node_modules"
    nohup node "$ROOT/scripts/localtunnel-open.js" >>"$LT_LOG" 2>&1 &
    echo $! >"$LT_PID_FILE"
  )
  local lt_pid url=""
  lt_pid="$(cat "$LT_PID_FILE" 2>/dev/null || echo "")"
  for _ in $(seq 1 40); do
    url="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.(loca\.lt|localtunnel\.me)' "$LT_LOG" 2>/dev/null | tail -1 || true)"
    if [[ -n "$url" ]]; then
      break
    fi
    if [[ -n "$lt_pid" ]] && ! kill -0 "$lt_pid" 2>/dev/null; then
      log "localtunnel נעצר מוקדם"
      tail -20 "$LT_LOG" | tee -a "$KEEP_LOG" || true
      return 1
    fi
    sleep 1
  done
  if [[ -z "$url" ]]; then
    log "לא התקבל קישור localtunnel"
    return 1
  fi
  printf '%s\n' "$url" >"$URL_FILE"
  sleep 2
  if public_ok "$url"; then
    log "localtunnel חי: $url"
    return 0
  fi
  sleep 3
  if public_ok "$url"; then
    log "localtunnel חי (המתנה): $url"
    return 0
  fi
  log "localtunnel נוצר אבל health נכשל: $url"
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
    if [[ -n "$url" ]]; then
      break
    fi
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
    return 0
  fi
  sleep 3
  if public_ok "$url"; then
    log "גיבוי חי (המתנה): $url"
    return 0
  fi
  log "גיבוי נוצר אבל health נכשל: $url"
  return 1
}

ensure_localtunnel() {
  local url
  url="$(read_url "$URL_FILE")"
  if ! pgrep -f 'localtunnel-open.js' >/dev/null 2>&1; then
    start_localtunnel
    return $?
  fi
  if [[ -z "$url" ]] || ! public_ok "$url"; then
    log "localtunnel לא בריא — מפעיל מחדש"
    start_localtunnel
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

log "===== keep-public-alive v2 (lt+lhr, כל ${CHECK_EVERY}ש׳) ====="

LOCK="/tmp/tazrim-keepalive.lock"
if [[ -f "$LOCK" ]]; then
  old_pid="$(cat "$LOCK" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    # Replace older keepalive with this stronger one
    if [[ "$old_pid" != "$$" ]]; then
      log "מחליף keepalive ישן (pid $old_pid)"
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

# Stop leftover Cloudflare quick tunnels (known flaky)
for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do
  kill -9 "$pid" 2>/dev/null || true
done

while true; do
  ensure_uvicorn || true
  ensure_localtunnel || true
  ensure_lhr || true
  sleep "$CHECK_EVERY"
done
