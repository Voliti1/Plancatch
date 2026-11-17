"""Current account's working hours, never an arbitrary user identifier."""
from fastapi import APIRouter, Response

from app.api.dependencies import CurrentUser, DatabaseSession
from app.schemas.availability import AvailabilityInput
from app.services import availability

router = APIRouter(prefix="/api/scheduling/availability", tags=["scheduling"])


@router.get("")
def read(current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return availability.read(db, current_user.id)


@router.put("")
def save(payload: AvailabilityInput, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return availability.save(db, current_user.id, payload)
