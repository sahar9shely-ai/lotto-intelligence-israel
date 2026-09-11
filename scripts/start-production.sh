#!/usr/bin/env bash
# Build the frontend and run תזרים as a single server on 0.0.0.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo "→ Building frontend..."
cd "$ROOT/frontend"
npm ci
VITE_API_BASE_URL= npm run build

echo "→ Starting API + UI on http://${HOST}:${PORT}"
cd "$ROOT/backend"
export PYTHONPATH="$ROOT/backend"
export FRONTEND_DIST="$ROOT/frontend/dist"
export APP_PUBLIC_URL="${APP_PUBLIC_URL:-http://localhost:${PORT}}"
# Always production DB (ignore polluted shell env from tests).
export INVESTMENTS_DB_PATH="$ROOT/backend/app/data/investments.db"

exec uvicorn app.main:app --host "$HOST" --port "$PORT"
