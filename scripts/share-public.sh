#!/usr/bin/env bash
# פתיחת תזרים לאינטרנט — מכל טלפון / מחשב / רשת
# Usage: ./scripts/share-public.sh
#
# חשוב: קישור trycloudflare.com משתנה רק אם מפעילים מנהרה חדשה.
# הסקריפט לא מחליף קישור קיים — אם כבר רצה tunnel, מדפיס את הקישור השמור.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
BIN_DIR="${HOME}/.local/bin"
CLOUDFLARED="${BIN_DIR}/cloudflared"
URL_FILE="${ROOT}/.public-url"
mkdir -p "$BIN_DIR"
export PATH="${BIN_DIR}:$PATH"

install_cloudflared() {
  local ver url
  ver="$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
  url="https://github.com/cloudflare/cloudflared/releases/download/${ver}/cloudflared-linux-amd64"
  echo "→ מתקין cloudflared ${ver}..."
  curl -fsSL -o "$CLOUDFLARED" "$url"
  chmod +x "$CLOUDFLARED"
}

if [[ ! -x "$CLOUDFLARED" ]]; then
  install_cloudflared
fi

print_locked_url() {
  local url="${1:-}"
  echo
  echo "=============================================="
  echo "  קישור ציבורי קבוע לסשן הזה (לא מחליפים):"
  echo "  ${url}"
  echo "=============================================="
  echo
}

# אם כבר יש מנהרה חיה — לא פותחים חדשה (מונע החלפת קישור ללקוחות)
if pgrep -f 'cloudflared tunnel --url' >/dev/null 2>&1; then
  if [[ -f "$URL_FILE" ]]; then
    LOCKED="$(tr -d '[:space:]' < "$URL_FILE")"
    if [[ -n "$LOCKED" ]]; then
      if curl -sf --max-time 12 "${LOCKED}/health" >/dev/null 2>&1; then
        print_locked_url "$LOCKED"
        echo "המנהרה כבר רצה ובריאה. לא נוצר קישור חדש."
        echo "לשמירה אוטומטית מפני נפילות: ./scripts/keep-public-alive.sh &"
        exit 0
      fi
      echo "נמצא cloudflared חי אבל הקישור השמור מת ($LOCKED)." >&2
      echo "מפעיל מחדש מנהרה..." >&2
      pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
      sleep 1
    fi
  fi
fi

# נעילה: אל תפתחי מנהרה חדשה אם כבר נשמר קישור ללקוחות (אלא אם FORCE_NEW_TUNNEL=1
# או שהקישור השמור כבר לא עובד)
if [[ -f "$URL_FILE" && "${FORCE_NEW_TUNNEL:-0}" != "1" ]]; then
  LOCKED="$(tr -d '[:space:]' < "$URL_FILE")"
  if [[ -n "$LOCKED" ]]; then
    if curl -sf --max-time 12 "${LOCKED}/health" >/dev/null 2>&1; then
      echo "נמצא קישור שמור ובריא ללקוחות:" >&2
      echo "  $LOCKED" >&2
      echo >&2
      echo "לא מופעלת מנהרה חדשה." >&2
      echo "לשמירה אוטומטית: ./scripts/keep-public-alive.sh &" >&2
      exit 0
    fi
    echo "הקישור השמור מת ($LOCKED) — פותחים מנהרה חדשה." >&2
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

LOG_FILE="${TMPDIR:-/tmp}/cloudflared.log"
: > "$LOG_FILE"

echo
echo "=============================================="
echo "  תזרים נפתח לאינטרנט"
echo "  חכי כמה שניות לקישור HTTPS הציבורי"
echo "  הקישור יישמר ב־.public-url ולא יוחלף אוטומטית"
echo "=============================================="
echo

"$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate >"$LOG_FILE" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 45); do
  if command -v rg >/dev/null 2>&1; then
    URL="$(rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)"
  else
    URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)"
  fi
  if [[ -n "$URL" ]]; then
    break
  fi
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    echo "cloudflared נעצר מוקדם מדי:" >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "לא התקבל קישור ציבורי בזמן" >&2
  kill "$CF_PID" 2>/dev/null || true
  exit 1
fi

printf '%s\n' "$URL" > "$URL_FILE"
print_locked_url "$URL"
echo "PID cloudflared: $CF_PID"

# Auto-start watchdog so dead quick-tunnels are recreated without manual intervention.
if ! pgrep -f 'keep-public-alive.sh' >/dev/null 2>&1; then
  nohup "$ROOT/scripts/keep-public-alive.sh" >/tmp/tazrim-keepalive.out 2>&1 &
  echo "הופעל keep-public-alive (pid $!) — יחיה מחדש uvicorn/מנהרה אם נופלים."
else
  echo "keep-public-alive כבר רץ."
fi
echo "לעצירה ידנית של המנהרה בלבד: kill $CF_PID"

# Keep tunnel attached to this shell when run in foreground.
wait "$CF_PID"
