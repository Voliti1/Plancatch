"""Authenticated task CRUD endpoints."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.deadlines import get_owned_deadline
from app.models.task import Task
from app.schemas.task import ScheduleType, TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def get_owned_task(task_id: uuid.UUID, user_id: uuid.UUID, db: DatabaseSession) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, current_user: CurrentUser, db: DatabaseSession) -> Task:
    if payload.deadline_id is not None:
        get_owned_deadline(payload.deadline_id, current_user.id, db)
    task = Task(user_id=current_user.id, **payload.model_dump())
    if task.is_completed:
        task.completed_at = datetime.now(UTC)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    current_user: CurrentUser,
    db: DatabaseSession,
    deadline_id: uuid.UUID | None = None,
    is_completed: bool | None = None,
    schedule_type: ScheduleType | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Task]:
    statement = select(Task).where(Task.user_id == current_user.id)
    if deadline_id is not None:
        statement = statement.where(Task.deadline_id == deadline_id)
    if is_completed is not None:
        statement = statement.where(Task.is_completed == is_completed)
    if schedule_type is not None:
        statement = statement.where(Task.schedule_type == schedule_type)
    return list(db.scalars(
        statement.order_by(Task.created_at.desc(), Task.id).limit(limit).offset(offset),
    ))


@router.get("/{task_id}", response_model=TaskResponse)
def read_task(task_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Task:
    return get_owned_task(task_id, current_user.id, db)


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Task:
    task = get_owned_task(task_id, current_user.id, db)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("deadline_id") is not None:
        get_owned_deadline(changes["deadline_id"], current_user.id, db)
    start = changes.get("earliest_start", task.earliest_start)
    end = changes.get("latest_end", task.latest_end)
    if start is not None and end is not None:
        # SQLite test databases return naive timestamps; PostgreSQL preserves UTC offsets.
        start = start.replace(tzinfo=UTC) if start.tzinfo is None else start
        end = end.replace(tzinfo=UTC) if end.tzinfo is None else end
        if start >= end:
            raise HTTPException(status_code=422, detail="latest_end must be after earliest_start")
    if "is_completed" in changes:
        if changes["is_completed"] and not task.is_completed:
            task.completed_at = datetime.now(UTC)
        elif not changes["is_completed"]:
            task.completed_at = None
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Response:
    task = get_owned_task(task_id, current_user.id, db)
    db.delete(task)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
