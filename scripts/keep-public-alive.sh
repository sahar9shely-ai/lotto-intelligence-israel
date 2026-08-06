#!/usr/bin/env bash
# שומר את תזרים חי באינטרנט: מפעיל מחדש uvicorn + cloudflared אם נופלים.
# מנהרות trycloudflare.com הזמניות נקטעות מצד Cloudflare — הסקריפט מזהה ופותח מחדש.
#
# Usage:
#   nohup ./scripts/keep-public-alive.sh >/tmp/tazrim-keepalive.out 2>&1 &
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
BIN_DIR="${HOME}/.local/bin"
CLOUDFLARED="${BIN_DIR}/cloudflared"
URL_FILE="${ROOT}/.public-url"
UV_LOG="${TMPDIR:-/tmp}/tazrim-uvicorn.log"
CF_LOG="${TMPDIR:-/tmp}/cloudflared.log"
KEEP_LOG="${TMPDIR:-/tmp}/tazrim-keepalive.log"
UV_PID_FILE="${TMPDIR:-/tmp}/tazrim-uvicorn.pid"
CF_PID_FILE="${TMPDIR:-/tmp}/tazrim-cloudflared.pid"
CHECK_EVERY="${CHECK_EVERY:-15}"

export PATH="${BIN_DIR}:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$BIN_DIR" "$(dirname "$KEEP_LOG")"

# ripgrep may be missing in background PATH — fall back to grep -E
extract_cf_url() {
  if command -v rg >/dev/null 2>&1; then
    rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" 2>/dev/null | tail -1 || true
  else
    grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" 2>/dev/null | tail -1 || true
  fi
}

cf_log_has_dead() {
  [[ -f "$CF_LOG" ]] || return 1
  if command -v rg >/dev/null 2>&1; then
    rg -q 'Tunnel not found|Unauthorized: Tunnel not found|control stream encountered a failure|Unable to reach the origin' "$CF_LOG" 2>/dev/null
  else
    grep -Eq 'Tunnel not found|Unauthorized: Tunnel not found|control stream encountered a failure|Unable to reach the origin' "$CF_LOG" 2>/dev/null
  fi
}

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$KEEP_LOG"
}

install_cloudflared() {
  local ver url
  ver="$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
  url="https://github.com/cloudflare/cloudflared/releases/download/${ver}/cloudflared-linux-amd64"
  log "מתקין cloudflared ${ver}..."
  curl -fsSL -o "$CLOUDFLARED" "$url"
  chmod +x "$CLOUDFLARED"
}

[[ -x "$CLOUDFLARED" ]] || install_cloudflared

local_ok() {
  curl -sf --max-time 4 "http://${HOST}:${PORT}/health" >/dev/null 2>&1
}

public_ok() {
  local url="${1:-}"
  [[ -n "$url" ]] || return 1
  curl -sf --max-time 12 "${url}/health" >/dev/null 2>&1
}

read_url() {
  [[ -f "$URL_FILE" ]] || { echo ""; return; }
  tr -d '[:space:]' < "$URL_FILE"
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

# Process alive but Cloudflare already killed the tunnel session.
cloudflared_zombie() {
  pgrep -f 'cloudflared tunnel --url' >/dev/null 2>&1 || return 1
  if cf_log_has_dead; then
    local url
    url="$(read_url)"
    if [[ -z "$url" ]] || ! public_ok "$url"; then
      return 0
    fi
  fi
  return 1
}

start_tunnel() {
  log "פותח מנהרת Cloudflare חדשה..."
  pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
  sleep 2
  : >"$CF_LOG"
  nohup "$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate \
    >>"$CF_LOG" 2>&1 &
  local cf_pid=$!
  echo "$cf_pid" >"$CF_PID_FILE"

  local url=""
  for _ in $(seq 1 60); do
    url="$(extract_cf_url "$CF_LOG")"
    if [[ -n "$url" ]]; then
      break
    fi
    if ! kill -0 "$cf_pid" 2>/dev/null; then
      log "cloudflared נעצר מוקדם — לוג:"
      tail -30 "$CF_LOG" | tee -a "$KEEP_LOG" || true
      return 1
    fi
    sleep 1
  done

  if [[ -z "$url" ]]; then
    log "לא התקבל קישור ציבורי"
    return 1
  fi

  printf '%s\n' "$url" >"$URL_FILE"
  sleep 3
  if public_ok "$url"; then
    log "מנהרה חיה: $url"
    return 0
  fi
  sleep 5
  if public_ok "$url"; then
    log "מנהרה חיה (אחרי המתנה): $url"
    return 0
  fi
  log "קישור נוצר אבל health ציבורי נכשל עדיין: $url"
  return 1
}

ensure_tunnel() {
  local url
  url="$(read_url)"

  if cloudflared_zombie; then
    log "זוהתה מנהרה מתה (תהליך חי, Cloudflare דחה) — מפעיל מחדש"
    start_tunnel
    return $?
  fi

  if ! pgrep -f 'cloudflared tunnel --url' >/dev/null 2>&1; then
    log "cloudflared לא רץ — מפעיל"
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

log "===== keep-public-alive התחיל (כל ${CHECK_EVERY}ש׳) ====="

# Single-instance lock
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
