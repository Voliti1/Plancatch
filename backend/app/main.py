"""FastAPI application factory."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.db.session import get_db, get_engine
from app.services.google_calendar import install_callback_log_filter


@asynccontextmanager
async def lifespan(application):
    """Poll committed intents; tests with a replaced DB never start a real worker."""
    stop = asyncio.Event()
    task = None
    if getattr(get_settings(), "db_host", None) and get_db not in application.dependency_overrides:
        async def worker():
            from app.services.google_sync import run_batch
            while not stop.is_set():
                delay = 1
                try:
                    await asyncio.to_thread(run_batch, get_engine())
                except Exception as error:  # noqa: BLE001 - Keep durable jobs for a later pass without exposing error contents.
                    logging.getLogger(__name__).warning("Google sync unavailable: %s", type(error).__name__)
                    delay = 30
                try:
                    await asyncio.wait_for(stop.wait(), timeout=delay)
                except TimeoutError:
                    pass
        task = asyncio.create_task(worker())
    try:
        yield
    finally:
        stop.set()
        if task:
            await task


def create_app() -> FastAPI:
    """Create and configure the PlanCatch API application."""
    settings = get_settings()
    install_callback_log_filter()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    application.include_router(api_router)
    return application


app = create_app()
