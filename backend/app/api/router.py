"""Top-level API router."""

from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.deadlines import router as deadlines_router
from app.api.routes.health import router as health_router
from app.api.routes.scheduled_events import router as scheduled_events_router
from app.api.routes.sources import router as sources_router
from app.api.routes.tasks import router as tasks_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(sources_router)
api_router.include_router(deadlines_router)
api_router.include_router(tasks_router)
api_router.include_router(scheduled_events_router)
