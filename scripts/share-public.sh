#!/usr/bin/env bash
# פתיחת תזרים לאינטרנט — מכל טלפון / מחשב / רשת
# משתמש ב־localtunnel עם subdomain קבוע (יציב יותר מ־trycloudflare הזמני).
# Usage: ./scripts/share-public.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
URL_FILE="${ROOT}/.public-url"
LT_DIR="${TMPDIR:-/tmp}/tazrim-lt"
LT_LOG="${TMPDIR:-/tmp}/localtunnel.log"
LT_PID_FILE="${TMPDIR:-/tmp}/tazrim-localtunnel.pid"
TUNNEL_SUBDOMAIN="${TUNNEL_SUBDOMAIN:-tazrim-sahar}"
export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
mkdir -p "$LT_DIR"

print_locked_url() {
  local url="${1:-}"
  echo
  echo "=============================================="
  echo "  קישור ציבורי לתזרים:"
  echo "  ${url}"
  echo "=============================================="
  echo
}

# אם כבר יש מנהרה חיה ובריאה — לא פותחים חדשה
if [[ -f "$URL_FILE" ]]; then
  LOCKED="$(tr -d '[:space:]' < "$URL_FILE")"
  if [[ -n "$LOCKED" ]] && curl -sf --max-time 12 -H 'bypass-tunnel-reminder: 1' "${LOCKED}/health" >/dev/null 2>&1; then
    if pgrep -f 'localtunnel-open.js' >/dev/null 2>&1; then
      print_locked_url "$LOCKED"
      echo "המנהרה כבר רצה ובריאה."
      if ! pgrep -f 'keep-public-alive.sh' >/dev/null 2>&1; then
        nohup "$ROOT/scripts/keep-public-alive.sh" >/tmp/tazrim-keepalive.out 2>&1 &
        echo "הופעל keep-public-alive (pid $!)."
      fi
      exit 0
    fi
  fi
fi

ensure_app() {
  if curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
    return 0
  fi
  echo "→ בונה ומפעיל את תזרים על פורט ${PORT}..."
  cd "$ROOT/frontend"
  if [[ ! -f dist/index.html ]]; then
    npm ci
    VITE_API_BASE_URL= npm run build
  fi
  export PYTHONPATH="$ROOT/backend"
  export FRONTEND_DIST="$ROOT/frontend/dist"
  export INVESTMENTS_DB_PATH="${INVESTMENTS_DB_PATH:-$ROOT/backend/app/data/investments.db}"
  export APP_PUBLIC_URL="http://localhost:${PORT}"
  cd "$ROOT/backend"
  uvicorn app.main:app --host 0.0.0.0 --port "$PORT" &
  APP_PID=$!
  trap 'kill '"$APP_PID"' 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do
    if curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "השרת לא עלה בזמן" >&2
  exit 1
}

ensure_app

if [[ ! -f "$LT_DIR/node_modules/localtunnel/package.json" ]]; then
  echo "→ מתקין localtunnel..."
  mkdir -p "$LT_DIR"
  if [[ ! -f "$LT_DIR/package.json" ]]; then
    printf '%s\n' '{"name":"tazrim-lt","private":true}' >"$LT_DIR/package.json"
  fi
  (cd "$LT_DIR" && npm install localtunnel@2.0.2)
fi

# עצור מנהרות ישנות (כולל Cloudflare הזמני) — לפי PID בלבד
for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do
  kill -9 "$pid" 2>/dev/null || true
done
for pid in $(pgrep -f 'localtunnel-open.js' || true); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1

: >"$LT_LOG"
(
  cd "$LT_DIR"
  export PORT TUNNEL_SUBDOMAIN
  export NODE_PATH="$LT_DIR/node_modules"
  nohup node "$ROOT/scripts/localtunnel-open.js" >>"$LT_LOG" 2>&1 &
  echo $! >"$LT_PID_FILE"
)
LT_PID="$(cat "$LT_PID_FILE")"

URL=""
for _ in $(seq 1 45); do
  URL="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.(loca\.lt|localtunnel\.me)' "$LT_LOG" 2>/dev/null | tail -1 || true)"
  if [[ -n "$URL" ]]; then
    break
  fi
  if ! kill -0 "$LT_PID" 2>/dev/null; then
    echo "localtunnel נעצר מוקדם מדי:" >&2
    cat "$LT_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "לא התקבל קישור ציבורי בזמן" >&2
  kill "$LT_PID" 2>/dev/null || true
  exit 1
fi

printf '%s\n' "$URL" > "$URL_FILE"
print_locked_url "$URL"
echo "PID localtunnel: $LT_PID"

if ! pgrep -f 'keep-public-alive.sh' >/dev/null 2>&1; then
  nohup "$ROOT/scripts/keep-public-alive.sh" >/tmp/tazrim-keepalive.out 2>&1 &
  echo "הופעל keep-public-alive (pid $!) — יחיה מחדש אם נופל."
else
  echo "keep-public-alive כבר רץ."
fi

# Foreground wait keeps tunnel tied to this shell when run interactively
wait "$LT_PID"
