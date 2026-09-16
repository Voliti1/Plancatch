"""Service health endpoint."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/")
def root() -> dict[str, str]:
    """Return a simple API identification response."""
    return {"message": "PlanCatch API"}


@router.get("/health")
def health() -> dict[str, str]:
    """Return the application health status."""
    return {"status": "ok"}
