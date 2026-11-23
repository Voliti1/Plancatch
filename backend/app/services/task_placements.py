"""Read calendar placements independently of a task's editable time window."""

from sqlalchemy import func, select

from app.models import ScheduledEvent
from app.schemas.task import TaskPlacement
from app.services.recurrence import utc


def confirmed_events(owner):
    return select(ScheduledEvent).where(
        ScheduledEvent.user_id == owner,
        ScheduledEvent.status.in_(("approved", "synced")),
    )


def placement_summary(owner):
    return confirmed_events(owner).with_only_columns(
        ScheduledEvent.task_id,
        func.min(ScheduledEvent.start_at).label("start_at"),
        func.max(ScheduledEvent.end_at).label("end_at"),
        func.count(ScheduledEvent.id).label("block_count"),
    ).group_by(ScheduledEvent.task_id).subquery()


def placement(start_at, end_at, block_count):
    if block_count:
        return TaskPlacement(start_at=utc(start_at), end_at=utc(end_at), block_count=block_count)
    return None
