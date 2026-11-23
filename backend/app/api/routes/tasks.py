"""Authenticated task CRUD endpoints."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy import or_, select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.deadlines import get_owned_deadline
from app.models.scheduled_event import ScheduledEvent
from app.models.task import Task
from app.models.task_plan import TaskDependency
from app.schemas.task import (
    OccurrenceUpdate,
    ScheduleType,
    TaskCreate,
    TaskDetailResponse,
    TaskPlacementBlock,
    TaskResponse,
    TaskUpdate,
)
from app.services import google_sync as sync
from app.services import task_occurrences as single
from app.services.recurrence import utc
from app.services.recurrence import validate as validate_recurrence
from app.services.task_placements import confirmed_events, placement, placement_summary

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def get_owned_task(task_id: uuid.UUID, user_id: uuid.UUID, db: DatabaseSession) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, current_user: CurrentUser, db: DatabaseSession) -> Task:
    sync.lock_owner(db, current_user.id)
    if payload.deadline_id is not None:
        get_owned_deadline(payload.deadline_id, current_user.id, db)
    values = payload.model_dump()
    values["recurrence"] = payload.recurrence.model_dump(mode="json") if payload.recurrence else None
    task = Task(user_id=current_user.id, **values)
    if task.is_completed:
        task.completed_at = datetime.now(UTC)
    db.add(task)
    db.flush()
    sync.enqueue_task(db, current_user.id, task.id)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    deadline_id: uuid.UUID | None = None,
    is_completed: bool | None = None,
    schedule_type: ScheduleType | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TaskResponse]:
    response.headers["Cache-Control"] = "no-store"
    summary = placement_summary(current_user.id)
    statement = select(Task, summary.c.start_at, summary.c.end_at, summary.c.block_count).outerjoin(
        summary, summary.c.task_id == Task.id,
    ).where(Task.user_id == current_user.id)
    if deadline_id is not None:
        statement = statement.where(Task.deadline_id == deadline_id)
    if is_completed is not None:
        statement = statement.where(Task.is_completed == is_completed)
    if schedule_type is not None:
        statement = statement.where(Task.schedule_type == schedule_type)
    rows = db.execute(statement.order_by(Task.created_at.desc(), Task.id).limit(limit).offset(offset))
    return [
        TaskResponse.model_validate(task).model_copy(update={"placement": placement(start, end, count)})
        for task, start, end, count in rows
    ]


@router.get("/{task_id}", response_model=TaskDetailResponse)
def read_task(task_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession, response: Response) -> TaskDetailResponse:
    response.headers["Cache-Control"] = "no-store"
    task = get_owned_task(task_id, current_user.id, db)
    events = db.execute(
        confirmed_events(current_user.id)
        .with_only_columns(ScheduledEvent.id, ScheduledEvent.start_at, ScheduledEvent.end_at)
        .where(ScheduledEvent.task_id == task.id)
        .order_by(ScheduledEvent.start_at, ScheduledEvent.end_at, ScheduledEvent.id)
    )
    blocks = [TaskPlacementBlock(id=identity, start_at=utc(start), end_at=utc(end)) for identity, start, end in events]
    result = TaskDetailResponse.model_validate(task)
    if blocks:
        result.placement = placement(blocks[0].start_at, max(block.end_at for block in blocks), len(blocks))
        result.placement_blocks = blocks
    return result


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Task:
    sync.lock_owner(db, current_user.id)
    task = get_owned_task(task_id, current_user.id, db)
    changes = payload.model_dump(exclude_unset=True)
    reset = changes.pop("reset_occurrences", False)
    if changes.get("deadline_id") is not None:
        get_owned_deadline(changes["deadline_id"], current_user.id, db)
    start = changes.get("earliest_start", task.earliest_start)
    end = changes.get("latest_end", task.latest_end)
    rule = changes.get("recurrence", task.recurrence)
    if task.series_id and (rule or changes.get("schedule_type", task.schedule_type) != "fixed" or not start or not end):
        raise HTTPException(422, "개별 변경한 일정은 시작·종료 시간이 있는 고정 할 일로 유지해 주세요.")
    try:
        validate_recurrence(rule, changes.get("schedule_type", task.schedule_type), start, end)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    if rule and db.scalar(select(ScheduledEvent.id).where(
        ScheduledEvent.task_id == task.id, ScheduledEvent.user_id == current_user.id).limit(1)):
        raise HTTPException(409, "이미 시간 배치가 있는 할 일은 반복 일정으로 바꿀 수 없습니다.")
    if "recurrence" in changes:
        changes["recurrence"] = payload.recurrence.model_dump(mode="json") if payload.recurrence else None
    single.reconcile(db, task, rule, start, end, reset)
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
    if (changes.get("schedule_type", task.schedule_type) != "flexible" or changes.get("recurrence", task.recurrence)) and db.scalar(
        select(TaskDependency.task_id).where(TaskDependency.user_id == current_user.id,
            or_(TaskDependency.task_id == task.id, TaskDependency.predecessor_id == task.id)).limit(1)):
        raise HTTPException(409, "먼저 작업 순서의 연결을 해제한 뒤 고정·반복 일정으로 바꿔 주세요.")
    for field, value in changes.items():
        setattr(task, field, value)
    sync.enqueue_task(db, current_user.id, task.id)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Response:
    sync.lock_owner(db, current_user.id)
    task = get_owned_task(task_id, current_user.id, db)
    synced_event = db.scalar(select(ScheduledEvent.id).where(
        ScheduledEvent.task_id == task.id,
        (ScheduledEvent.google_event_id.is_not(None)) | (ScheduledEvent.status == "synced"),
    ).limit(1))
    if synced_event is not None:
        raise HTTPException(status_code=409, detail="Synchronize linked calendar events before deleting this task")
    single.remove_children(db, task)
    db.delete(task)
    sync.enqueue_task(db, current_user.id, task_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{task_id}/occurrences", response_model=TaskResponse)
def read_occurrence(task_id: uuid.UUID, original_start: AwareDatetime,
                    current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return single.effective(db, get_owned_task(task_id, current_user.id, db), original_start)


@router.patch("/{task_id}/occurrences", response_model=TaskResponse)
def update_occurrence(task_id: uuid.UUID, original_start: AwareDatetime, payload: OccurrenceUpdate,
                      current_user: CurrentUser, db: DatabaseSession):
    sync.lock_owner(db, current_user.id)
    task = get_owned_task(task_id, current_user.id, db)
    try:
        child = single.update(db, task, original_start, payload)
    except ValueError:
        raise HTTPException(422, "제목과 시작·종료 일시, 소요시간을 확인해 주세요.") from None
    db.commit()
    db.refresh(child)
    return child


@router.delete("/{task_id}/occurrences", status_code=204)
def delete_occurrence(task_id: uuid.UUID, original_start: AwareDatetime,
                      current_user: CurrentUser, db: DatabaseSession):
    sync.lock_owner(db, current_user.id)
    single.remove(db, get_owned_task(task_id, current_user.id, db), original_start)
    db.commit()
    return Response(status_code=204)
