#!/usr/bin/env bash
# Per-boot reconciliation: make sure the local PostgreSQL server is running.
# The backend and frontend themselves are launched as terminals.
set -euo pipefail

PG_VER="$(pg_lsclusters -h | awk '{print $1}' | head -1)"
sudo pg_ctlcluster "$PG_VER" main start 2>/dev/null || true
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then
    echo "PostgreSQL is ready."
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready in time." >&2
exit 1
