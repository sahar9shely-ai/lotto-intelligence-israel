#!/usr/bin/env bash
# שומר את תזרים חי באינטרנט דרך localtunnel (כתובת יציבה יותר מ־trycloudflare).
# Usage:
#   nohup ./scripts/keep-public-alive.sh >/tmp/tazrim-keepalive.out 2>&1 &
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
URL_FILE="${ROOT}/.public-url"
UV_LOG="${TMPDIR:-/tmp}/tazrim-uvicorn.log"
LT_LOG="${TMPDIR:-/tmp}/localtunnel.log"
KEEP_LOG="${TMPDIR:-/tmp}/tazrim-keepalive.log"
UV_PID_FILE="${TMPDIR:-/tmp}/tazrim-uvicorn.pid"
LT_PID_FILE="${TMPDIR:-/tmp}/tazrim-localtunnel.pid"
LT_DIR="${TMPDIR:-/tmp}/tazrim-lt"
CHECK_EVERY="${CHECK_EVERY:-15}"
TUNNEL_SUBDOMAIN="${TUNNEL_SUBDOMAIN:-tazrim-sahar}"

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$(dirname "$KEEP_LOG")" "$LT_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$KEEP_LOG"
}

local_ok() {
  curl -sf --max-time 4 "http://${HOST}:${PORT}/health" >/dev/null 2>&1
}

public_ok() {
  local url="${1:-}"
  [[ -n "$url" ]] || return 1
  curl -sf --max-time 15 \
    -H 'bypass-tunnel-reminder: 1' \
    -H 'User-Agent: Mozilla/5.0 (compatible; tazrim-keepalive/1.0)' \
    "${url}/health" >/dev/null 2>&1
}

read_url() {
  [[ -f "$URL_FILE" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$URL_FILE"
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
  pkill -f 'uvicorn app.main:app' 2>/dev/null || true
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
      log "uvicorn חי (pid $(cat "$UV_PID_FILE" 2>/dev/null || echo '?'))"
      return 0
    fi
    sleep 0.5
  done
  log "uvicorn לא עלה בזמן"
  return 1
}

stop_old_tunnels() {
  # Prefer localtunnel; stop flaky Cloudflare quick tunnels to avoid confusion.
  for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  for pid in $(pgrep -f 'localtunnel-open.js' || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  if [[ -f "$LT_PID_FILE" ]]; then
    kill "$(cat "$LT_PID_FILE")" 2>/dev/null || true
  fi
  sleep 1
}

start_tunnel() {
  ensure_localtunnel_pkg || return 1
  log "פותח מנהרת localtunnel (subdomain=${TUNNEL_SUBDOMAIN})..."
  stop_old_tunnels
  : >"$LT_LOG"
  (
    cd "$LT_DIR"
    export PORT
    export TUNNEL_SUBDOMAIN
    export NODE_PATH="$LT_DIR/node_modules"
    nohup node "$ROOT/scripts/localtunnel-open.js" >>"$LT_LOG" 2>&1 &
    echo $! >"$LT_PID_FILE"
  )
  local lt_pid
  lt_pid="$(cat "$LT_PID_FILE" 2>/dev/null || echo "")"

  local url=""
  for _ in $(seq 1 45); do
    url="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.(loca\.lt|localtunnel\.me)' "$LT_LOG" 2>/dev/null | tail -1 || true)"
    if [[ -n "$url" ]]; then
      break
    fi
    if [[ -n "$lt_pid" ]] && ! kill -0 "$lt_pid" 2>/dev/null; then
      log "localtunnel נעצר מוקדם — לוג:"
      tail -40 "$LT_LOG" | tee -a "$KEEP_LOG" || true
      return 1
    fi
    sleep 1
  done

  if [[ -z "$url" ]]; then
    log "לא התקבל קישור ציבורי מ־localtunnel"
    tail -40 "$LT_LOG" | tee -a "$KEEP_LOG" || true
    return 1
  fi

  printf '%s\n' "$url" >"$URL_FILE"
  sleep 2
  if public_ok "$url"; then
    log "מנהרה חיה: $url"
    return 0
  fi
  sleep 4
  if public_ok "$url"; then
    log "מנהרה חיה (אחרי המתנה): $url"
    return 0
  fi
  log "קישור נוצר אבל health ציבורי נכשל: $url"
  return 1
}

ensure_tunnel() {
  local url
  url="$(read_url)"

  local lt_alive=0
  if pgrep -f 'localtunnel-open.js' >/dev/null 2>&1; then
    lt_alive=1
  fi

  if [[ "$lt_alive" -eq 0 ]]; then
    log "localtunnel לא רץ — מפעיל"
    start_tunnel
    return $?
  fi

  if [[ -z "$url" ]]; then
    log ".public-url ריק — מפעיל מנהרה חדשה"
    start_tunnel
    return $?
  fi

  if public_ok "$url"; then
    return 0
  fi

  log "קישור ציבורי לא מגיב ($url) — מפעיל מנהרה חדשה"
  start_tunnel
}

log "===== keep-public-alive (localtunnel) התחיל (כל ${CHECK_EVERY}ש׳) ====="

LOCK="/tmp/tazrim-keepalive.lock"
if [[ -f "$LOCK" ]]; then
  old_pid="$(cat "$LOCK" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    log "כבר רץ (pid $old_pid) — יוצא"
    exit 0
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

while true; do
  ensure_uvicorn || true
  ensure_tunnel || true
  sleep "$CHECK_EVERY"
done
