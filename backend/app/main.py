"""FastAPI application factory."""

from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    """Create and configure the PlanCatch API application."""
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
    )
    application.include_router(api_router)
    return application


app = create_app()
