#!/usr/bin/env bash
# פתיחת תזרים לאינטרנט — Cloudflare + keepalive
# Usage: ./scripts/share-public.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
URL_FILE="${ROOT}/.public-url"
BIN_DIR="${HOME}/.local/bin"
CLOUDFLARED="${BIN_DIR}/cloudflared"
export PATH="${BIN_DIR}:$PATH"
mkdir -p "$BIN_DIR"

if [[ ! -x "$CLOUDFLARED" ]]; then
  ver="$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
  curl -fsSL -o "$CLOUDFLARED" \
    "https://github.com/cloudflare/cloudflared/releases/download/${ver}/cloudflared-linux-amd64"
  chmod +x "$CLOUDFLARED"
fi

print_url() {
  echo
  echo "=============================================="
  echo "  קישור ציבורי לתזרים:"
  echo "  ${1}"
  echo "=============================================="
  echo
}

if [[ -f "$URL_FILE" ]]; then
  LOCKED="$(tr -d '[:space:]' < "$URL_FILE")"
  if [[ -n "$LOCKED" ]] && curl -sf --max-time 12 -H 'User-Agent: Mozilla/5.0' -H 'Accept: text/html' "${LOCKED}/" >/dev/null 2>&1; then
    print_url "$LOCKED"
    if ! pgrep -f 'keep-public-alive.sh' >/dev/null 2>&1; then
      nohup "$ROOT/scripts/keep-public-alive.sh" >/tmp/tazrim-keepalive.out 2>&1 &
    fi
    exit 0
  fi
fi

if ! curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
  echo "השרת המקומי לא רץ על פורט ${PORT}" >&2
  exit 1
fi

for pid in $(pgrep -f 'localtunnel-open.js' || true); do kill -9 "$pid" 2>/dev/null || true; done
for pid in $(pgrep -f '/cloudflared tunnel --url' || true); do kill -9 "$pid" 2>/dev/null || true; done
sleep 1

LOG="${TMPDIR:-/tmp}/cloudflared.log"
: >"$LOG"
nohup "$CLOUDFLARED" tunnel --url "http://${HOST}:${PORT}" --protocol http2 --no-autoupdate >>"$LOG" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 45); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "לא התקבל קישור" >&2
  exit 1
fi

printf '%s\n' "$URL" >"$URL_FILE"
print_url "$URL"

if ! pgrep -f 'keep-public-alive.sh' >/dev/null 2>&1; then
  nohup "$ROOT/scripts/keep-public-alive.sh" >/tmp/tazrim-keepalive.out 2>&1 &
  echo "הופעל keep-public-alive (pid $!)"
fi

wait "$CF_PID"
