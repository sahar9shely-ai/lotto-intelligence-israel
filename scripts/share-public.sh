#!/usr/bin/env bash
# פתיחת תזרים לאינטרנט — מכל טלפון / מחשב / רשת
# Usage: ./scripts/share-public.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
BIN_DIR="${HOME}/.local/bin"
CLOUDFLARED="${BIN_DIR}/cloudflared"
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

echo
echo "=============================================="
echo "  תזרים נפתח לאינטרנט"
echo "  חכי כמה שניות לקישור HTTPS הציבורי"
echo "  ואז פתחי אותו מכל מכשיר"
echo "=============================================="
echo

exec "$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --no-autoupdate
