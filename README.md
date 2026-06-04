# Lotto Intelligence Israel - Phase 1 Scaffold

Production-grade initial monorepo scaffold for Phase 1 MVP.

## Included

- `backend/` - FastAPI service with:
  - typed settings via Pydantic
  - structured JSON logging
  - SQLAlchemy PostgreSQL-ready setup
  - Alembic migration setup
  - `GET /health` endpoint only
- `frontend/` - React + TypeScript + Vite app with:
  - Hebrew RTL base setup
  - routing
  - base layout
  - dashboard placeholder
  - system health placeholder
  - API client for backend health
- `docker/`:
  - `docker-compose.yml` for local development
  - PostgreSQL, backend, frontend services
- root:
  - `.env.example`
  - `.gitignore`
  - this `README.md`

## Constraints implemented

- No lotto business logic
- No import logic
- No statistics logic
- No login/auth screens
- No prediction/recommendation/gambling features

## Quick start (Docker Compose)

1. Copy env file:

```bash
cp .env.example .env
```

2. Start services:

```bash
docker compose -f docker/docker-compose.yml up --build
```

3. Open:
- Frontend: <http://localhost:5173>
- Backend health: <http://localhost:8000/health>

## Monorepo structure

```text
backend/
frontend/
docker/
```

## Windows Database Runtime Validation

Use one of the two supported options below to unblock runtime DB validation.

### Option A: Docker Desktop

1. Install Docker Desktop for Windows.
2. Start Docker Desktop and wait until Docker is fully running.
3. From project root, run:

```powershell
docker compose -f docker/docker-compose.yml up --build
```

4. In a second terminal, run Alembic migration:

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
```

5. Verify health endpoint:

```powershell
Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing | Select-Object -ExpandProperty Content
```

### Option B: Local PostgreSQL (Windows native)

1. Install PostgreSQL 16 for Windows (include command-line tools).
2. Create database and user/password matching `.env` / `backend/.env`:
   - DB: `lotto_intelligence`
   - User: `lotto_user`
   - Password: `lotto_password`
   - Host: `localhost`
   - Port: `5432`
3. Confirm PostgreSQL is reachable:

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 5432
```

4. Run migration:

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
```

5. Check current revision:

```powershell
.\.venv\Scripts\python.exe -m alembic current
```

6. Run SQL inspection queries:

```powershell
psql -h localhost -U lotto_user -d lotto_intelligence -c "\dt"
psql -h localhost -U lotto_user -d lotto_intelligence -c "\d lottery_draws"
psql -h localhost -U lotto_user -d lotto_intelligence -c "\d draw_numbers"
psql -h localhost -U lotto_user -d lotto_intelligence -c "\d strong_numbers"
```

## Troubleshooting (Windows)

- `docker` command not found
  - Install Docker Desktop, then restart terminal/Windows session.
  - Verify with: `docker --version`

- Port `5432` unavailable
  - Another PostgreSQL instance/service may already be using it.
  - Check with: `Test-NetConnection 127.0.0.1 -Port 5432`
  - Reconfigure local PostgreSQL port or stop conflicting service.

- Port `8000` already in use
  - Stop existing process on 8000 before starting backend.
  - Example:
    `Get-NetTCPConnection -LocalPort 8000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }`

- `psql` not found
  - Install PostgreSQL command-line tools or add PostgreSQL `bin` directory to PATH.
  - Verify with: `where.exe psql`

- Alembic hanging due to wrong host
  - Ensure `POSTGRES_HOST=localhost` in `backend/.env` for non-Docker runs.
  - For Docker Compose runs, use `POSTGRES_HOST=db` in container context.

## Operational Snapshot Runbook (Phase 1)

Use this internal operational endpoint to safely generate or reuse a published statistics snapshot from already imported historical data. This does not expose prediction or recommendation functionality.

### Endpoint

- `POST /api/v1/admin/stats/snapshots/generate`

### Request body

```json
{
  "game_code": "IL_LOTTO",
  "game_variant": "main",
  "rule_version": "v1",
  "date_from": "2025-01-01",
  "date_to": "2025-12-31",
  "dry_run": false,
  "triggered_by": "ops-manual-run"
}
```

Notes:
- `date_from` and `date_to` are optional.
- If omitted, the engine uses the full current historical draw range for the selected game rule.
- `dry_run=true` calculates the dataset hash and counts without persisting a snapshot.

### Response fields

- `snapshot_id`
- `reused_existing`
- `draw_count`
- `dataset_hash_sha256`
- `status`

### Example (PowerShell)

```powershell
$payload = @{
  game_code = "IL_LOTTO"
  game_variant = "main"
  rule_version = "v1"
  dry_run = $false
  triggered_by = "ops-manual-run"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/v1/admin/stats/snapshots/generate" `
  -ContentType "application/json" `
  -Body $payload
```

### Operational behavior

- If an identical snapshot payload already exists for the same game/window/hash, the operation returns that existing snapshot (`reused_existing=true`).
- If current draw data changed, a new published snapshot is generated and previous published snapshot for the same window is superseded.
- If no current draws exist for the selected window, the endpoint returns a 400 error envelope.

