"""Show existing source deadlines and fixed manual schedules without DB writes."""

from datetime import timedelta
from heapq import nsmallest
from itertools import chain

from fastapi import APIRouter, HTTPException, Response
from pydantic import AwareDatetime
from sqlalchemy import exists, or_, select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.scheduled_events import utc
from app.models.deadline import Deadline
from app.models.scheduled_event import ScheduledEvent
from app.models.task import Task
from app.schemas.calendar_registration import (
    CalendarRegistration,
    CalendarRegistrationsPage,
)
from app.services.recurrence import occurrences

router = APIRouter(prefix="/api/calendar/registrations", tags=["calendar"])
MAX_PER_KIND = 1000


@router.get("", response_model=CalendarRegistrationsPage)
def list_registrations(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    start_from: AwareDatetime,
    end_before: AwareDatetime,
) -> CalendarRegistrationsPage:
    response.headers["Cache-Control"] = "no-store"
    if not timedelta(0) < end_before - start_from <= timedelta(days=62):
        raise HTTPException(422, "캘린더 조회 기간은 0일 초과 62일 이하여야 합니다.")
    first, last = utc(start_from), utc(end_before)
    deadlines = list(
        db.execute(
            select(Deadline.id, Deadline.title, Deadline.due_at, Deadline.is_confirmed)
            .where(
                Deadline.user_id == current_user.id,
                Deadline.due_at >= first,
                Deadline.due_at < last,
            )
            .order_by(Deadline.due_at, Deadline.id)
            .limit(MAX_PER_KIND + 1)
        )
    )
    # A flexible task's window is availability, never an actual event. A fixed
    # task already placed (even cancelled) must not reappear as a second event.
    placed = exists().where(
        ScheduledEvent.task_id == Task.id, ScheduledEvent.user_id == current_user.id
    )
    tasks = list(
        db.execute(
            select(Task.id, Task.title, Task.earliest_start, Task.latest_end, Task.is_completed, Task.recurrence)
            .where(
                Task.user_id == current_user.id,
                Task.schedule_type == "fixed",
                Task.earliest_start.is_not(None),
                Task.latest_end.is_not(None),
                Task.latest_end > Task.earliest_start,
                Task.earliest_start < last,
                or_(Task.latest_end > first, Task.recurrence.is_not(None)),
                ~placed,
            )
            .order_by(Task.earliest_start, Task.id)
            .limit(MAX_PER_KIND + 1)
        )
    )
    entries = [
        CalendarRegistration(
            id=d.id,
            kind="deadline",
            title=d.title,
            start_at=utc(d.due_at),
            is_confirmed=d.is_confirmed,
        )
        for d in deadlines[:MAX_PER_KIND]
    ]
    task_entries = (
        CalendarRegistration(
            id=t.id,
            kind="fixed_task",
            title=t.title,
            start_at=start,
            end_at=end,
            is_completed=t.is_completed,
            is_recurring=bool(t.recurrence),
        )
        for t in tasks[:MAX_PER_KIND]
        for start, end in occurrences(t.earliest_start, t.latest_end, t.recurrence, first, last, MAX_PER_KIND * 2 + 1)
    )
    entries = nsmallest(MAX_PER_KIND * 2 + 1, chain(entries, task_entries),
                       key=lambda item: (item.start_at, item.kind, str(item.id)))
    return CalendarRegistrationsPage(
        entries=entries[:MAX_PER_KIND * 2],
        has_more=len(entries) > MAX_PER_KIND * 2 or len(deadlines) > MAX_PER_KIND or len(tasks) > MAX_PER_KIND,
    )
