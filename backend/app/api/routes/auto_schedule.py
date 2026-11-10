"""Owned automatic planning previews and explicit atomic approval."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import AwareDatetime
from sqlalchemy import and_, case, exists, func, or_, select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models import Deadline, ScheduledEvent, SchedulePlan, Task
from app.schemas.schedule_plan import ApprovalInput, PreviewInput
from app.schemas.task import TaskResponse
from app.services import auto_schedule as service
from app.services import schedule_history as history

router = APIRouter(prefix="/api/scheduling", tags=["scheduling"])


@router.get("/tasks")
def candidates(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    q: Annotated[str, Query(max_length=255)] = "",
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    replace_existing: bool = False,
):
    response.headers["Cache-Control"] = "no-store"
    active = exists().where(
        ScheduledEvent.task_id == Task.id,
        ScheduledEvent.user_id == current_user.id,
        ScheduledEvent.status.in_(["approved", "synced"]),
    )
    # The earliest completion limit wins; an undated task can still have a
    # starting window. Join only this owner's deadline, never another account's.
    limit_at = case(
        (Task.latest_end.is_(None), Deadline.due_at),
        (Deadline.due_at.is_(None), Task.latest_end),
        (Task.latest_end < Deadline.due_at, Task.latest_end),
        else_=Deadline.due_at,
    )
    sort_at = func.coalesce(limit_at, Task.earliest_start)
    unsafe = exists().where(
        ScheduledEvent.task_id == Task.id,
        ScheduledEvent.user_id == current_user.id,
        ScheduledEvent.status.in_(["approved", "synced"]),
        or_(
            ScheduledEvent.start_at <= service.now(),
            ScheduledEvent.status == "synced",
            ScheduledEvent.google_event_id.is_not(None),
            ScheduledEvent.is_user_approved.is_(False),
        ),
    )
    query = (
        select(Task, sort_at.label("sort_at"))
        .outerjoin(
            Deadline,
            and_(Deadline.id == Task.deadline_id, Deadline.user_id == current_user.id),
        )
        .where(
            Task.user_id == current_user.id,
            Task.schedule_type == "flexible",
            Task.recurrence.is_(None),
            Task.series_id.is_(None),
            Task.is_completed.is_(False),
            (active & ~unsafe) if replace_existing else ~active,
        )
    )
    if q.strip():
        query = query.where(Task.title.icontains(q.strip(), autoescape=True))
    tasks = list(
        db.execute(
            query.order_by(sort_at.asc().nulls_last(), Task.title.asc(), Task.id)
            .offset(offset)
            .limit(101)
        )
    )
    return {
        "entries": [
            {
                **TaskResponse.model_validate(task).model_dump(),
                "sort_at": service.stamp(at),
            }
            for task, at in tasks[:100]
        ],
        "has_more": len(tasks) > 100,
        "next_offset": offset + 100 if len(tasks) > 100 else None,
    }


@router.post("/preview", status_code=201)
def preview(
    payload: PreviewInput,
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    return service.preview(db, current_user.id, payload)


@router.get("/plans")
def list_plans(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    state: Literal["all", "pending", "approved", "expired"] = "all",
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
    before_at: AwareDatetime | None = None,
    before_id: uuid.UUID | None = None,
):
    response.headers["Cache-Control"] = "no-store"
    if (before_at is None) != (before_id is None):
        raise HTTPException(422, "목록의 다음 위치를 확인해 주세요.")
    moment = history.now()
    query = select(SchedulePlan).where(SchedulePlan.user_id == current_user.id)
    if state == "approved":
        query = query.where(SchedulePlan.approved_at.is_not(None))
    elif state in {"pending", "expired"}:
        query = query.where(
            SchedulePlan.approved_at.is_(None),
            SchedulePlan.expires_at > moment
            if state == "pending"
            else SchedulePlan.expires_at <= moment,
        )
    if before_at is not None:
        # Convert first so invalid extreme timezone offsets fail with a public 422.
        try:
            cursor_at = service.utc(before_at)
        except (ValueError, OverflowError):
            raise HTTPException(422, "목록의 다음 위치를 확인해 주세요.") from None
        query = query.where(
            or_(
                SchedulePlan.created_at < cursor_at,
                and_(SchedulePlan.created_at == cursor_at, SchedulePlan.id < before_id),
            )
        )
    rows = list(
        db.scalars(
            query.order_by(
                SchedulePlan.created_at.desc(), SchedulePlan.id.desc()
            ).limit(limit + 1)
        )
    )
    entries = history.summaries(db, current_user.id, rows[:limit])
    last = rows[limit - 1] if len(rows) > limit else None
    return {
        "entries": entries,
        "next_cursor": {"created_at": service.stamp(last.created_at), "id": last.id}
        if last
        else None,
    }


@router.get("/plans/{plan_id}")
def read_plan(
    plan_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    plan = service.owned_plan(db, current_user.id, plan_id)
    return {
        **service.plan_response(plan),
        "saved_state": history.summaries(db, current_user.id, [plan])[0]["saved_state"],
    }


@router.post("/plans/{plan_id}/approve")
def approve(
    plan_id: uuid.UUID,
    payload: ApprovalInput,
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    return service.approve(db, current_user.id, plan_id, payload)
