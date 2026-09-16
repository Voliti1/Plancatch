"""Owner-scoped CRUD for local calendar placements."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import AwareDatetime
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.tasks import get_owned_task
from app.models.scheduled_event import ScheduledEvent
from app.schemas.scheduled_event import (
    ScheduledEventCreate,
    ScheduledEventResponse,
    ScheduledEventUpdate,
)

router = APIRouter(prefix="/api/scheduled-events", tags=["scheduled-events"])


def utc(value: datetime) -> datetime:
    """Normalize timestamps; SQLite returns saved UTC values without tzinfo."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def owned_event(event_id: uuid.UUID, user_id: uuid.UUID, db: DatabaseSession) -> ScheduledEvent:
    event = db.scalar(select(ScheduledEvent).where(
        ScheduledEvent.id == event_id, ScheduledEvent.user_id == user_id,
    ))
    if event is None:
        raise HTTPException(status_code=404, detail="Scheduled event not found")
    return event


def require_local_event(event: ScheduledEvent) -> None:
    if event.google_event_id is not None or event.status == "synced":
        raise HTTPException(status_code=409, detail="Use calendar synchronization to change synced events")


@router.post("", response_model=ScheduledEventResponse, status_code=201)
def create_event(
    payload: ScheduledEventCreate, current_user: CurrentUser, db: DatabaseSession,
) -> ScheduledEvent:
    get_owned_task(payload.task_id, current_user.id, db)
    values = payload.model_dump()
    values["start_at"] = utc(payload.start_at)
    values["end_at"] = utc(payload.end_at)
    event = ScheduledEvent(
        user_id=current_user.id, is_user_approved=payload.status == "approved", **values,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("", response_model=list[ScheduledEventResponse])
def list_events(
    current_user: CurrentUser,
    db: DatabaseSession,
    task_id: uuid.UUID | None = None,
    status: Literal["recommended", "approved", "synced", "cancelled"] | None = None,
    start_from: AwareDatetime | None = None,
    end_before: AwareDatetime | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ScheduledEvent]:
    if start_from is not None and end_before is not None and start_from >= end_before:
        raise HTTPException(status_code=422, detail="end_before must be after start_from")
    statement = select(ScheduledEvent).where(ScheduledEvent.user_id == current_user.id)
    if task_id is not None:
        statement = statement.where(ScheduledEvent.task_id == task_id)
    if status is not None:
        statement = statement.where(ScheduledEvent.status == status)
    # Include any block overlapping the requested half-open calendar window.
    if start_from is not None:
        statement = statement.where(ScheduledEvent.end_at > utc(start_from))
    if end_before is not None:
        statement = statement.where(ScheduledEvent.start_at < utc(end_before))
    return list(db.scalars(statement.order_by(
        ScheduledEvent.start_at, ScheduledEvent.id,
    ).limit(limit).offset(offset)))


@router.get("/{event_id}", response_model=ScheduledEventResponse)
def read_event(event_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> ScheduledEvent:
    return owned_event(event_id, current_user.id, db)


@router.patch("/{event_id}", response_model=ScheduledEventResponse)
def update_event(
    event_id: uuid.UUID, payload: ScheduledEventUpdate,
    current_user: CurrentUser, db: DatabaseSession,
) -> ScheduledEvent:
    event = owned_event(event_id, current_user.id, db)
    require_local_event(event)
    changes = payload.model_dump(exclude_unset=True)
    for field in ("start_at", "end_at"):
        if field in changes:
            changes[field] = utc(changes[field])
    if utc(changes.get("start_at", event.start_at)) >= utc(changes.get("end_at", event.end_at)):
        raise HTTPException(status_code=422, detail="end_at must be after start_at")
    for field, value in changes.items():
        setattr(event, field, value)
    event.is_user_approved = event.status == "approved"
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Response:
    event = owned_event(event_id, current_user.id, db)
    require_local_event(event)
    db.delete(event)
    db.commit()
    return Response(status_code=204)
