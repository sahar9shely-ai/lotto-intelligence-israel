# Lotto Intelligence Israel

Production-grade educational analytics platform for Israeli Lotto historical draw analysis.

Phase 1 MVP is complete and tagged as `v1.0.0`.

## Project Scope (Phase 1)

This repository provides:

- Historical draw import and validation pipeline
- Versioned draw storage with current/superseded revisions
- Deterministic statistics and snapshot generation engine
- REST APIs for health, import, draws, and analytics retrieval
- Operational snapshot generation endpoint (generate/reuse/dry-run)
- React frontend dashboard and analytics screens (RTL, responsive)

This repository does **not** provide:

- Prediction features
- Recommendation features
- Gambling advice

## Tech Stack

### Backend

- Python, FastAPI
- SQLAlchemy + Alembic
- PostgreSQL
- Pydantic schemas
- Pytest test suite

### Frontend

- React + TypeScript (strict mode)
- React Router
- TanStack Query
- Recharts
- Vite
- Hebrew RTL UI

## Repository Layout

```text
backend/      FastAPI service, import/statistics engines, tests, migrations
frontend/     React application with analytics screens
docker/       Docker Compose stack definitions
README.md     Project documentation
```

## Implemented API Endpoints

### Health

- `GET /health`

### Import

- `POST /api/v1/import/draws`

### Draws

- `GET /api/v1/draws`
- `GET /api/v1/draws/{draw_id}`

### Statistics

- `GET /api/v1/stats/frequency`
- `GET /api/v1/stats/strong-number`
- `GET /api/v1/stats/pairs`
- `GET /api/v1/stats/summary`

### Operational Snapshot

- `POST /api/v1/admin/stats/snapshots/generate`

## Frontend Screens (Phase 1)

- Dashboard (`/dashboard`)
- Draw History (`/draws`)
- Number Frequency (`/stats/frequency`)
- Strong Number Statistics (`/stats/strong-number`)
- Pair Analysis (`/stats/pairs`)
- Snapshot Management (`/stats/snapshots`)
- System Health (`/health`)

## Local Setup

1. Copy environment file:

```bash
cp .env.example .env
```

2. Start full stack:

```bash
docker compose -f docker/docker-compose.yml up --build
```

3. Open:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend health: [http://localhost:8000/health](http://localhost:8000/health)

## Database Migration

From `backend/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
```

## Validation Commands

### Backend

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

### Frontend

```powershell
cd frontend
npm run build
npm run typecheck
npm run validate:routes
```

## Release Information

- Current release tag: `v1.0.0`
- Release notes: `RELEASE_NOTES_v1.0.0.md`

## Known Limitations (Phase 1)

- Authentication/authorization is not yet implemented
- Operational hardening (rate limits, full observability stack) is partial
- Frontend bundle optimization can be improved via code splitting

## Phase 2 Direction

- Security hardening (authn/authz, RBAC, endpoint protection)
- CI/CD and deployment automation
- Expanded observability (metrics, tracing, alerting)
- Frontend automated tests and performance optimization
- Scalability and load/performance hardening

