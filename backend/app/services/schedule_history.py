"""Read-only, owner-scoped preview history and current placement counts."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.models import ScheduledEvent, Task
from app.services.recurrence import SEOUL, utc


def now():
    return datetime.now(UTC)


def summaries(db, owner, plans):
    # At most 20 plans x 200 blocks; one bounded query, no provider calls.
    identities = [
        identity for plan in plans for identity in (plan.approved_event_ids or [])
    ]
    ids = [uuid.UUID(identity) for identity in identities]
    events = (
        {
            str(event.id): event
            for event in db.scalars(
                select(ScheduledEvent)
                .join(Task, Task.id == ScheduledEvent.task_id)
                .where(
                    ScheduledEvent.user_id == owner,
                    Task.user_id == owner,
                    ScheduledEvent.id.in_(ids),
                )
            )
        }
        if ids
        else {}
    )
    result = []
    moment = now()
    for plan in plans:
        approved = plan.approved_at is not None
        state = (
            "approved"
            if approved
            else "expired"
            if utc(plan.expires_at) <= moment
            else "pending"
        )
        saved = None
        first_active = None
        if approved:
            active = changed = deleted = inactive = 0
            originals = {block["id"]: block for block in plan.blocks}
            for identity in plan.approved_event_ids or []:
                event = events.get(identity)
                if event is None:
                    deleted += 1
                    continue
                if event.status in {"approved", "synced"}:
                    active += 1
                    start = utc(event.start_at)
                    if first_active is None or start < first_active:
                        first_active = start
                else:
                    inactive += 1
                block = originals.get(identity)
                if block and (
                    utc(event.start_at) != datetime.fromisoformat(block["start_at"])
                    or utc(event.end_at) != datetime.fromisoformat(block["end_at"])
                ):
                    changed += 1
            saved = {
                "active_count": active,
                "changed_count": changed,
                "deleted_count": deleted,
                "inactive_count": inactive,
            }
        tasks = plan.details.get("tasks", [])
        result.append(
            {
                "id": plan.id,
                "created_at": utc(plan.created_at),
                "expires_at": utc(plan.expires_at),
                "approved_at": utc(plan.approved_at) if approved else None,
                "state": state,
                "blocked": bool(plan.details.get("blocked")),
                "replace_existing": bool(plan.details.get("replace_existing")),
                "start_at": plan.request["start_at"],
                "end_at": plan.request["end_at"],
                "task_titles": [task["title"] for task in tasks],
                "task_count": len(tasks),
                "block_count": len(plan.blocks),
                "suggested_times": [
                    {key: block[key] for key in ("start_at", "end_at")}
                    for block in sorted(plan.blocks, key=lambda item: item["start_at"])[:3]
                ],
                "unplaced_count": len(plan.details.get("unplaced", [])),
                "calendar_date": first_active.astimezone(SEOUL).date().isoformat() if first_active else None,
                "saved_state": saved,
            }
        )
    return result
