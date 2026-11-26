"""Service health endpoint."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.db.session import get_session_factory

router = APIRouter(tags=["health"])


@router.get("/")
def root() -> dict[str, str]:
    """Return a simple API identification response."""
    return {"message": "PlanCatch API"}


@router.get("/health")
def health() -> dict[str, str]:
    """Report readiness only when the database can execute a query."""
    try:
        with get_session_factory()() as db:
            db.execute(text("SELECT 1")).scalar_one()
    except (SQLAlchemyError, RuntimeError):
        raise HTTPException(503, "database_unavailable") from None
    return {"status": "ok"}
