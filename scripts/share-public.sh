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
      print_locked_url "$LOCKED"
      echo "המנהרה כבר רצה. לא נוצר קישור חדש."
      exit 0
    fi
  fi
  echo "cloudflared כבר רץ, אבל .public-url חסר. לא מפעילים מנהרה חדשה." >&2
  echo "מצאי את הקישור בלוג הקיים (/tmp/cloudflared.log) ושמרי ב־.public-url" >&2
  exit 1
fi

# נעילה: אל תפתחי מנהרה חדשה אם כבר נשמר קישור ללקוחות (אלא אם FORCE_NEW_TUNNEL=1)
if [[ -f "$URL_FILE" && "${FORCE_NEW_TUNNEL:-0}" != "1" ]]; then
  LOCKED="$(tr -d '[:space:]' < "$URL_FILE")"
  if [[ -n "$LOCKED" ]]; then
    echo "נמצא קישור שמור ללקוחות:" >&2
    echo "  $LOCKED" >&2
    echo >&2
    echo "לא מופעלת מנהרה חדשה (זה היה מחליף את הקישור)." >&2
    echo "אם המנהרה מתה ויש צורך בקישור חדש במפורש:" >&2
    echo "  FORCE_NEW_TUNNEL=1 ./scripts/share-public.sh" >&2
    exit 1
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

"$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --no-autoupdate >"$LOG_FILE" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL="$(rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)"
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
echo "לעצירה ידנית בלבד: kill $CF_PID"
echo "(עצירה = הקישור הישן יפסיק לעבוד)"

wait "$CF_PID"
