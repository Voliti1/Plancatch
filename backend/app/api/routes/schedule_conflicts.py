"""Read-only conflict checks; saving remains an explicit, separate action."""
from fastapi import APIRouter, Response

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.scheduled_events import owned_event
from app.api.routes.tasks import get_owned_task
from app.schemas.schedule_conflict import ConflictCheck
from app.services.schedule_conflicts import preview

router = APIRouter(prefix="/api/schedules/conflicts", tags=["schedules"])


@router.post("")
def check_conflicts(payload: ConflictCheck, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    for identity in (payload.exclude_task_id, payload.placement_task_id, payload.exclude_occurrence_task_id):
        if identity:
            get_owned_task(identity, current_user.id, db)
    if payload.exclude_event_id:
        owned_event(payload.exclude_event_id, current_user.id, db)
    return preview(db, current_user.id, payload)
