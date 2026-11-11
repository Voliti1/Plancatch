"""Owner-locked occurrence changes: EXDATE on the master plus an optional linked task."""
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select

from app.models import Task
from app.schemas.task import TaskCreate, TaskResponse
from app.services import google_sync as sync
from app.services.recurrence import occurrences, utc

MAX_EXCEPTIONS = 1000


def is_instance(task, at, rule=None, start=None, end=None):
    at = utc(at)
    start, end = start or task.earliest_start, end or task.latest_end
    rule = task.recurrence if rule is None else rule
    if not rule or not start or not end or at >= datetime.max.replace(tzinfo=UTC):
        return False
    # Membership concerns the original start, not earlier long-running occurrences.
    return any(begin == at for begin, _ in occurrences(start, utc(start) + timedelta(microseconds=1),
        rule, at, at + timedelta(microseconds=1), 1))


def owned_instance(task, at):
    try:
        at = utc(at)
    except OverflowError:
        raise HTTPException(422, "확인할 수 있는 날짜 범위를 벗어났습니다.") from None
    if task.series_id or not task.recurrence or not is_instance(task, at):
        raise HTTPException(404, "이 반복 일정에 해당 날짜가 없습니다. 전체 반복 설정을 확인해 주세요.")
    return at


def child_at(db, task, at):
    return db.scalar(select(Task).where(Task.user_id == task.user_id,
        Task.series_id == task.id, Task.original_start == at))


def excluded(task, at):
    return at in {utc(datetime.fromisoformat(value)) for value in task.excluded_starts or []}


def effective(db, task, at):
    at = owned_instance(task, at)
    child = child_at(db, task, at)
    if child:
        return TaskResponse.model_validate(child)
    if excluded(task, at):
        raise HTTPException(404, "삭제된 반복 일정입니다.")
    return TaskResponse.model_validate(task).model_copy(update={
        "series_id": task.id, "original_start": at, "recurrence": None, "exception_count": 0,
        "earliest_start": at, "latest_end": at + (utc(task.latest_end) - utc(task.earliest_start))})


def exclude(task, at):
    values = list(task.excluded_starts or [])
    if excluded(task, at):
        return
    if len(values) >= MAX_EXCEPTIONS:
        raise HTTPException(409, "개별 변경은 반복 일정당 1,000회까지 가능합니다. 새 반복 일정으로 나누어 등록해 주세요.")
    task.excluded_starts = sorted([*values, at.isoformat()])


def update(db, task, at, payload):
    at = owned_instance(task, at)
    current = effective(db, task, at)
    values = {key: getattr(current, key) for key in TaskCreate.model_fields}
    values.update(payload.model_dump(exclude_unset=True))
    # The new task stays fixed, belongs to the same owner and never becomes another series.
    if not values["earliest_start"] or not values["latest_end"]:
        raise HTTPException(422, "이번 일정의 시작·종료 일시를 모두 입력해 주세요.")
    for field in ("earliest_start", "latest_end"):
        values[field] = utc(values[field])  # SQLite drops the persisted UTC offset.
    preserve_reminders = values["google_reminders"] is None
    if preserve_reminders:
        values["google_reminders"] = {"mode": "none"}
    validated = TaskCreate.model_validate(values).model_dump()
    if preserve_reminders:
        validated["google_reminders"] = None
    child = child_at(db, task, at)
    if child is None:
        child = Task(user_id=task.user_id, series_id=task.id, original_start=at)
        db.add(child)
    # Keep the same completion timestamp contract as normal task create/update.
    # Inherited completed occurrences retain their existing effective timestamp.
    if validated["is_completed"]:
        child.completed_at = current.completed_at or datetime.now(UTC)
    else:
        child.completed_at = None
    for name, value in validated.items():
        setattr(child, name, value)
    exclude(task, at)
    db.flush()
    sync.enqueue_task(db, task.user_id, task.id)
    sync.enqueue_task(db, task.user_id, child.id)
    return child


def remove(db, task, at):
    at = owned_instance(task, at)
    exclude(task, at)
    child = child_at(db, task, at)
    if child:
        identity = child.id
        db.delete(child)
        db.flush()
        sync.enqueue_task(db, task.user_id, identity)
    sync.enqueue_task(db, task.user_id, task.id)


def remove_children(db, task, keep=None):
    for child in list(db.scalars(select(Task).where(Task.series_id == task.id, Task.user_id == task.user_id))):
        if keep is not None and utc(child.original_start) in keep:
            continue
        identity = child.id
        db.delete(child)
        db.flush()
        sync.enqueue_task(db, task.user_id, identity)


def reconcile(db, task, rule, start, end, reset):
    if not task.excluded_starts:
        return
    pattern_changed = (not rule or not start or not end or
        utc(start) != utc(task.earliest_start) or utc(end) != utc(task.latest_end) or
        any(rule.get(key, 1) != task.recurrence.get(key, 1) for key in ("frequency", "interval")))
    if pattern_changed and not reset:
        raise HTTPException(409, "시작 시간이나 반복 주기를 바꾸려면 개별 변경 초기화에 체크해 주세요.")
    keep = set() if reset or not rule else {utc(datetime.fromisoformat(at)) for at in task.excluded_starts
        if is_instance(task, datetime.fromisoformat(at), rule, start, end)}
    remove_children(db, task, keep)
    task.excluded_starts = sorted(at.isoformat() for at in keep) or None
