#!/usr/bin/env bash
# Notify Slack work chat when the public URL changes (Incoming Webhook).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${1:-}"
DB="${INVESTMENTS_DB_PATH:-$ROOT/backend/app/data/investments.db}"
HOOK_FILE="${ROOT}/.slack-webhook"

if [[ -z "$URL" ]]; then
  URL="$(tr -d '[:space:]' < "${ROOT}/.public-url" 2>/dev/null || true)"
fi
[[ -n "$URL" ]] || exit 0

HOOK=""
if [[ -f "$HOOK_FILE" ]]; then
  HOOK="$(tr -d '[:space:]' < "$HOOK_FILE")"
fi
if [[ -z "$HOOK" ]] && command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB" ]]; then
  HOOK="$(sqlite3 "$DB" "SELECT slack_webhook_url FROM app_settings LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
fi
[[ -n "$HOOK" ]] || exit 0

payload="$(python3 - <<PY
import json
url = """${URL}"""
print(json.dumps({
  "text": f"תזרים — כניסה מהירה: {url}",
  "blocks": [
    {"type": "section", "text": {"type": "mrkdwn", "text": "*תזרים — כניסה מהירה לעבודה*"}},
    {"type": "actions", "elements": [{
      "type": "button",
      "text": {"type": "plain_text", "text": "פתח את תזרים", "emoji": True},
      "url": url,
      "style": "primary"
    }]},
    {"type": "context", "elements": [{"type": "mrkdwn", "text": f"קישור חי: `{url}`"}]}
  ]
}, ensure_ascii=False))
PY
)"

curl -sS -m 12 -X POST -H 'Content-Type: application/json' -d "$payload" "$HOOK" >/dev/null 2>&1 || true
