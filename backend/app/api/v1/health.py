from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(tags=["health"])


class DependencyStatus(BaseModel):
    postgres: str
    redis: str
    queue: str


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    time_utc: datetime
    dependencies: DependencyStatus


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    # Scaffold only: dependencies are placeholders until full integrations are added.
    dependencies = DependencyStatus(postgres="unknown", redis="unknown", queue="unknown")
    return HealthResponse(
        status="ok",
        service=settings.project_name,
        version="0.1.0",
        time_utc=datetime.now(timezone.utc),
        dependencies=dependencies,
    )

