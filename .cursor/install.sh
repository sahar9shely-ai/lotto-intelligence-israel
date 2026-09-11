#!/usr/bin/env bash
# Idempotent install for the "תזרים" (Lotto Intelligence) dev environment.
# Prepares: system packages, local PostgreSQL, backend venv + deps + migrations,
# frontend node deps, and a local backend/.env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Installing system packages (postgresql, python venv)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv postgresql postgresql-contrib

PG_VER="$(pg_lsclusters -h | awk '{print $1}' | head -1)"
echo "==> Ensuring PostgreSQL cluster ${PG_VER}/main is running"
sudo pg_ctlcluster "$PG_VER" main start 2>/dev/null || true
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

echo "==> Ensuring database role and database exist"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lotto_user') THEN
    CREATE ROLE lotto_user LOGIN PASSWORD 'lotto_password';
  END IF;
END
$$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='lotto_intelligence'" | grep -q 1; then
  sudo -u postgres createdb -O lotto_user lotto_intelligence
fi
sudo -u postgres psql -q -c "GRANT ALL PRIVILEGES ON DATABASE lotto_intelligence TO lotto_user;"

echo "==> Writing backend/.env (only if missing)"
if [ ! -f backend/.env ]; then
  cat > backend/.env <<'ENV'
PROJECT_NAME=תזרים
ENVIRONMENT=development
LOG_LEVEL=INFO
POSTGRES_DB=lotto_intelligence
POSTGRES_USER=lotto_user
POSTGRES_PASSWORD=lotto_password
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
JWT_SECRET=tazrim-dev-secret-change-me-32chars!
APP_PUBLIC_URL=http://localhost:5173
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_USE_TLS=true
ENV
fi

echo "==> Setting up backend Python environment"
cd backend
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
. .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "==> Applying database migrations"
PYTHONPATH=. alembic upgrade head
deactivate
cd "$REPO_ROOT"

echo "==> Installing frontend dependencies"
cd frontend
npm install
cd "$REPO_ROOT"

echo "==> Install complete."
