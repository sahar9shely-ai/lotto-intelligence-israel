from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.admin_stats import router as admin_stats_router
from app.api.v1.draws import router as draws_router
from app.api.v1.health import router as health_router
from app.api.v1.imports import router as imports_router
from app.api.v1.stats import router as stats_router
from app.core.config import settings
from app.core.error_handlers import register_error_handlers
from app.core.logging import configure_logging

configure_logging(settings.log_level)

app = FastAPI(
    title=settings.project_name,
    version="0.1.0",
)
register_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(imports_router)
app.include_router(draws_router)
app.include_router(stats_router)
app.include_router(admin_stats_router)

