from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def _candidate_dist_dirs() -> list[Path]:
    env = os.getenv("FRONTEND_DIST", "").strip()
    here = Path(__file__).resolve()
    backend_root = here.parents[1]  # backend/
    repo_root = here.parents[2]  # repo/
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.extend(
        [
            backend_root / "static",
            repo_root / "frontend" / "dist",
            Path("/app/frontend/dist"),
            Path("/app/static"),
        ]
    )
    return candidates


def resolve_frontend_dist() -> Path | None:
    for path in _candidate_dist_dirs():
        if path.is_dir() and (path / "index.html").is_file():
            return path.resolve()
    return None


def mount_frontend(app: FastAPI) -> Path | None:
    """Serve the Vite production build from the same origin as the API."""
    dist = resolve_frontend_dist()
    if dist is None:
        return None

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/")
    async def spa_index() -> FileResponse:
        return FileResponse(dist / "index.html")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # Never shadow API / health / docs
        if (
            full_path.startswith("api/")
            or full_path.startswith("docs")
            or full_path.startswith("openapi")
            or full_path.startswith("redoc")
            or full_path == "health"
        ):
            raise HTTPException(status_code=404, detail="Not Found")

        candidate = dist / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")

    return dist
