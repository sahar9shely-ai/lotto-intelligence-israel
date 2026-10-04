import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.admin_stats import router as admin_stats_router
from app.api.v1.agreements import router as agreements_router
from app.api.v1.assistant import router as assistant_router
from app.api.v1.auth import router as auth_router
from app.api.v1.draws import router as draws_router
from app.api.v1.goturs import router as goturs_router
from app.api.v1.health import router as health_router
from app.api.v1.imports import router as imports_router
from app.api.v1.investments import init_investment_db, router as investments_router
from app.api.v1.stats import router as stats_router
from app.api.v1.tutorials import router as tutorials_router
from app.api.v1.push import router as push_router
from app.core.config import settings
from app.core.error_handlers import register_error_handlers
from app.core.logging import configure_logging
from app.spa import mount_frontend

configure_logging(settings.log_level)

app = FastAPI(
    title="תזרים — מעקב השקעות",
    version="0.3.0",
)
register_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(imports_router)
app.include_router(draws_router)
app.include_router(stats_router)
app.include_router(admin_stats_router)
app.include_router(goturs_router)
app.include_router(auth_router)
app.include_router(investments_router)
app.include_router(agreements_router)
app.include_router(assistant_router)
app.include_router(tutorials_router)
app.include_router(push_router)

# Production: same-origin UI (built Vite app). Dev without dist keeps API-only.
FRONTEND_DIST_MOUNTED = mount_frontend(app)


async def _push_delivery_loop() -> None:
    from app.services.push_service import run_pending_pushes, run_scheduled_reminders
    last_reminder_scan = 0.0
    while True:
        clock = asyncio.get_running_loop().time()
        if not last_reminder_scan or clock - last_reminder_scan >= 60:
            last_reminder_scan = clock
            try:
                await asyncio.to_thread(run_scheduled_reminders)
            except Exception:
                logging.getLogger(__name__).warning("Push reminder scan failed; it will be retried later")
        try:
            await asyncio.to_thread(run_pending_pushes, limit=10)
        except Exception:
            # Avoid logging subscription endpoints or device encryption keys.
            logging.getLogger(__name__).warning("Push delivery scan failed; queued notices will be retried")
        await asyncio.sleep(5)


@app.on_event("startup")
async def on_startup() -> None:
    init_investment_db()
    if settings.investor_tutorials_enabled:
        from app.services.tutorial_service import LESSONS, published_lessons

        count = len(published_lessons())
        logging.getLogger(__name__).log(
            logging.INFO if count == len(LESSONS) else logging.WARNING,
            "Investor tutorials publication check: %s lessons available", count,
        )
    if settings.web_push_enabled:
        app.state.push_delivery_task = asyncio.create_task(_push_delivery_loop())
        logging.getLogger(__name__).info("Push delivery and reminder worker started")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    task = getattr(app.state, "push_delivery_task", None)
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

