# Production all-in-one image: React UI + FastAPI API + SQLite
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Same-origin API (empty base URL)
ENV VITE_API_BASE_URL=
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV FRONTEND_DIST=/app/frontend/dist
ENV INVESTMENTS_DB_PATH=/data/investments.db
ENV APP_PUBLIC_URL=http://localhost:8000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /frontend/dist /app/frontend/dist

RUN mkdir -p /data

EXPOSE 8000

CMD ["sh", "-c", "PYTHONPATH=/app uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
