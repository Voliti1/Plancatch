"""Owned automatic planning previews and explicit atomic approval."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import exists, select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models import ScheduledEvent, Task
from app.schemas.schedule_plan import ApprovalInput, PreviewInput
from app.schemas.task import TaskResponse
from app.services import auto_schedule as service

router = APIRouter(prefix="/api/scheduling", tags=["scheduling"])


@router.get("/tasks")
def candidates(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    q: Annotated[str, Query(max_length=255)] = "",
):
    response.headers["Cache-Control"] = "no-store"
    active = exists().where(
        ScheduledEvent.task_id == Task.id,
        ScheduledEvent.user_id == current_user.id,
        ScheduledEvent.status.in_(["approved", "synced"]),
    )
    query = select(Task).where(
        Task.user_id == current_user.id,
        Task.schedule_type == "flexible",
        Task.recurrence.is_(None),
        Task.series_id.is_(None),
        Task.is_completed.is_(False),
        ~active,
    )
    if q.strip():
        query = query.where(Task.title.icontains(q.strip(), autoescape=True))
    tasks = list(db.scalars(query.order_by(Task.created_at.desc(), Task.id).limit(101)))
    return {
        "entries": [TaskResponse.model_validate(task) for task in tasks[:100]],
        "has_more": len(tasks) > 100,
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


@router.get("/plans/{plan_id}")
def read_plan(
    plan_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    return service.plan_response(service.owned_plan(db, current_user.id, plan_id))


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
