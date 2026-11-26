"""Read-only, globally paginated list of owned deadlines and tasks."""

from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import DateTime, func, literal, select, union_all

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models import Deadline, Task
from app.schemas.deadline import DeadlineResponse
from app.schemas.task import TaskResponse
from app.services.task_placements import placement, placement_summary

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.get("")
def list_schedules(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    q: Annotated[str, Query(max_length=255)] = "",
    include_deadlines: bool = True,
    include_tasks: bool = True,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["Cache-Control"] = "no-store"
    query = q.strip()
    queries = []
    summary = placement_summary(current_user.id) if include_tasks else None
    for model, kind, at, included in (
        (Deadline, "deadline", Deadline.due_at, include_deadlines),
        (
            Task,
            "task",
            func.coalesce(summary.c.start_at, Task.earliest_start, Task.latest_end) if summary is not None else None,
            include_tasks,
        ),
    ):
        if not included:
            continue
        statement = select(
            model.id.label("id"), literal(kind).label("kind"), at.label("at")
        ).where(model.user_id == current_user.id)
        if kind == "task":
            statement = statement.outerjoin(summary, summary.c.task_id == Task.id).add_columns(
                summary.c.start_at, summary.c.end_at, summary.c.block_count,
            )
        else:
            statement = statement.add_columns(
                literal(None, DateTime(timezone=True)).label("start_at"),
                literal(None, DateTime(timezone=True)).label("end_at"),
                literal(None).label("block_count"),
            )
        if query:
            statement = statement.where(model.title.icontains(query, autoescape=True))
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
    for row in page:
        item = by_kind[row.kind].get(row.id)
        if (
            item is not None
        ):  # A concurrent deletion must not become a leaked/stale record.
            schema = DeadlineResponse if row.kind == "deadline" else TaskResponse
            result = schema.model_validate(item)
            if row.kind == "task":
                result.placement = placement(row.start_at, row.end_at, row.block_count)
            entries.append({"kind": row.kind, "item": result})
    return {"entries": entries, "has_more": len(ordered) > limit}
