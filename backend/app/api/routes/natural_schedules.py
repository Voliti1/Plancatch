"""Authenticated preview only: no source, task or deadline writes."""
from fastapi import APIRouter

from app.api.dependencies import CurrentUser
from app.schemas.natural_schedule import NaturalScheduleDraft, NaturalScheduleRequest
from app.services.natural_schedule import interpret

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.post("/interpret", response_model=NaturalScheduleDraft)
def interpret_schedule(payload: NaturalScheduleRequest, current_user: CurrentUser):
    return interpret(payload.text)
