"""Read-only, globally paginated list of owned deadlines and tasks."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, literal, or_, select, union_all

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models import Deadline, Task
from app.schemas.deadline import DeadlineResponse
from app.schemas.task import TaskResponse
from app.services.recurrence import occurrences, utc

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def next_task_end(task: Task, now: datetime) -> datetime | None:
    if not task.recurrence:
        return utc(task.latest_end) if task.latest_end else None
    upcoming = occurrences(
        task.earliest_start, task.latest_end, task.recurrence, now,
        datetime.max.replace(tzinfo=UTC) - timedelta(days=1),
        limit=1, excluded=task.excluded_starts,
    )
    return upcoming[0][1] if upcoming else None


@router.get("")
def list_schedules(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    q: Annotated[str, Query(max_length=255)] = "",
    include_deadlines: bool = True,
    include_tasks: bool = True,
    hide_past: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["Cache-Control"] = "no-store"
    query = q.strip()
    now = datetime.now(UTC)
    queries = []
    recurring_ends = {}
    for model, kind, at, included in (
        (Deadline, "deadline", Deadline.due_at, include_deadlines),
        (
            Task,
            "task",
            func.coalesce(Task.earliest_start, Task.latest_end),
            include_tasks,
        ),
    ):
        if not included:
            continue
        statement = select(
            model.id.label("id"), literal(kind).label("kind"), at.label("at")
        ).where(model.user_id == current_user.id)
        if query:
            statement = statement.where(model.title.icontains(query, autoescape=True))
        if hide_past and kind == "deadline":
            statement = statement.where(or_(Deadline.due_at.is_(None), Deadline.due_at > now))
        elif hide_past:
            candidates = select(Task).where(
                Task.user_id == current_user.id,
                Task.recurrence.is_not(None),
            )
            if query:
                candidates = candidates.where(Task.title.icontains(query, autoescape=True))
            recurring_ends = {task.id: next_task_end(task, now) for task in db.scalars(candidates)}
            finished_series = [task_id for task_id, end in recurring_ends.items() if end is None]
            statement = statement.where(
                or_(Task.latest_end.is_(None), Task.latest_end > now, Task.recurrence.is_not(None))
            )
            if finished_series:
                statement = statement.where(Task.id.not_in(finished_series))
        queries.append(statement)
    if not queries:
        return {"entries": [], "has_more": False}
    combined = union_all(*queries).subquery()
    ordered = list(
        db.execute(
            select(combined)
            .order_by(combined.c.at.asc().nulls_last(), combined.c.kind, combined.c.id)
            .limit(limit + 1)
            .offset(offset)
        )
    )
    page = ordered[:limit]
    by_kind = {}
    for model, kind in ((Deadline, "deadline"), (Task, "task")):
        ids = [row.id for row in page if row.kind == kind]
        by_kind[kind] = (
            {
                item.id: item
                for item in db.scalars(
                    select(model).where(
                        model.user_id == current_user.id, model.id.in_(ids)
                    )
                )
            }
            if ids
            else {}
        )
    entries = []
    next_refresh = None
    for row in page:
        item = by_kind[row.kind].get(row.id)
        if (
            item is not None
        ):  # A concurrent deletion must not become a leaked/stale record.
            schema = DeadlineResponse if row.kind == "deadline" else TaskResponse
            entries.append({"kind": row.kind, "item": schema.model_validate(item)})
            if hide_past:
                if row.kind == "deadline":
                    end = utc(item.due_at) if item.due_at else None
                elif item.recurrence:
                    end = recurring_ends.get(item.id)
                else:
                    end = next_task_end(item, now)
                if end and (next_refresh is None or end < next_refresh):
                    next_refresh = end
    result = {"entries": entries, "has_more": len(ordered) > limit}
    if next_refresh:
        result["refresh_at"] = next_refresh
    return result
