"""Bounded local preparation checks. No planning writes, AI or Google requests."""

from datetime import UTC, datetime
from math import ceil

from sqlalchemy import select
from sqlalchemy.orm import load_only

from app.models import ScheduledEvent, Task
from app.schemas.deadline_readiness import DeadlineReadiness
from app.services.recurrence import utc

MAX_TASKS = 200
MAX_EVENTS = 2000


def now():
    return datetime.now(UTC)


def merged(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result


def minutes(intervals):
    # Sub-minute fragments must not inflate the time reserved for work.
    return int(sum((end - start).total_seconds() for start, end in intervals) // 60)


def assess(db, owner, deadline):
    at = now()
    target = utc(deadline.safe_due_at or deadline.due_at)
    tasks = list(
        db.scalars(
            select(Task)
            .options(
                load_only(
                    Task.id,
                    Task.is_completed,
                    Task.recurrence,
                    Task.series_id,
                    Task.estimated_minutes,
                    Task.schedule_type,
                    Task.earliest_start,
                    Task.latest_end,
                )
            )
            .where(
                Task.user_id == owner,
                Task.deadline_id == deadline.id,
            )
            .order_by(Task.id)
            .limit(MAX_TASKS + 1)
        )
    )
    truncated = len(tasks) > MAX_TASKS
    tasks = tasks[:MAX_TASKS]
    pending = [task for task in tasks if not task.is_completed]
    # Calendar registrations hide the original fixed time after ANY placement,
    # including a cancelled/recommended one. Never resurrect that hidden time.
    placed_ids = (
        set(
            db.scalars(
                select(ScheduledEvent.task_id)
                .where(
                    ScheduledEvent.user_id == owner,
                    ScheduledEvent.task_id.in_([task.id for task in pending]),
                )
                .distinct()
            )
        )
        if pending
        else set()
    )
    events = (
        list(
            db.execute(
                select(
                    ScheduledEvent.task_id,
                    ScheduledEvent.start_at,
                    ScheduledEvent.end_at,
                )
                .join(Task, Task.id == ScheduledEvent.task_id)
                .where(
                    ScheduledEvent.user_id == owner,
                    Task.user_id == owner,
                    Task.deadline_id == deadline.id,
                    Task.is_completed.is_(False),
                    ScheduledEvent.status.in_(["approved", "synced"]),
                )
                .order_by(ScheduledEvent.id)
                .limit(MAX_EVENTS + 1)
            )
        )
        if pending
        else []
    )
    truncated |= len(events) > MAX_EVENTS
    by_task = {}
    for event in events[:MAX_EVENTS]:
        by_task.setdefault(event.task_id, []).append(
            (utc(event.start_at), utc(event.end_at))
        )

    unknown = required = planned = 0
    all_intervals = []
    separated_seconds = 0
    for task in pending:
        # A recurring master is not one unit of remaining work. Do not invent progress.
        if task.recurrence or task.series_id:
            unknown += 1
            continue
        estimate = task.estimated_minutes
        if (
            estimate is None
            and task.schedule_type == "fixed"
            and task.earliest_start
            and task.latest_end
        ):
            estimate = ceil(
                (utc(task.latest_end) - utc(task.earliest_start)).total_seconds() / 60
            )
        if estimate is None or estimate <= 0:
            unknown += 1
            continue
        required += estimate
        intervals = by_task.get(task.id, [])
        if (
            task.id not in placed_ids
            and task.schedule_type == "fixed"
            and task.earliest_start
            and task.latest_end
        ):
            intervals = [(utc(task.earliest_start), utc(task.latest_end))]
        left, right = at, target
        if task.schedule_type == "flexible":
            left = max(at, utc(task.earliest_start)) if task.earliest_start else at
            right = min(target, utc(task.latest_end)) if task.latest_end else target
        slots = merged(
            [
                (max(start, left), min(end, right))
                for start, end in intervals
                if max(start, left) < min(end, right)
            ]
        )
        planned += min(estimate, minutes(slots))
        separated_seconds += sum((end - start).total_seconds() for start, end in slots)
        all_intervals.extend(slots)

    overlap = separated_seconds > sum(
        (end - start).total_seconds() for start, end in merged(all_intervals)
    )
    remaining = max(0, int((target - at).total_seconds() // 60))
    reasons = []
    if tasks and not pending and not truncated:
        state = "completed"
        reasons.append("연결된 할 일이 모두 완료로 표시되어 있습니다.")
    elif utc(deadline.due_at) <= at:
        state = "overdue"
        reasons.append("공식 마감 시각이 지났습니다. 완료 여부를 확인해 주세요.")
    elif target <= at:
        state = "attention"
        reasons.append(
            "안전 마감 시각이 지났습니다. 공식 마감 전에 남은 작업을 확인해 주세요."
        )
    elif required > remaining:
        state = "shortage"
        reasons.append(
            "목표 시각까지 남은 전체 시간보다 미완료 할 일의 예상 시간이 더 깁니다."
        )
    elif not tasks or unknown or truncated:
        state = "unknown"
    elif (
        planned < required or overlap or remaining <= 1440 or not deadline.is_confirmed
    ):
        state = "attention"
    else:
        state = "planned"
        reasons.append(
            "확인한 할 일의 예상 시간만큼 목표 시각 전 배치 시간이 있습니다."
        )
    if not tasks:
        reasons.append("연결된 할 일이 없어 준비 상태를 판단하기 어렵습니다.")
    if unknown:
        reasons.append(
            "소요시간이 없거나 반복 중인 할 일이 있습니다. 남은 작업량을 직접 확인해 주세요."
        )
    if truncated:
        reasons.append(
            "할 일이나 배치가 많아 일부만 확인했습니다. 전체 준비 상태는 판단을 보류합니다."
        )
    if required > planned and pending:
        reasons.append(
            "목표 시각 전 배치 시간이 부족합니다. 할 일의 시간 배치를 확인해 주세요."
        )
    if overlap:
        reasons.append(
            "연결된 할 일의 배치 시간이 겹칩니다. 동시에 진행할 수 있는지 확인해 주세요."
        )
    if state == "attention" and 0 < remaining <= 1440:
        reasons.append("목표 시각까지 24시간 이내로 남았습니다.")
    if not deadline.is_confirmed and state != "completed":
        reasons.append(
            "마감일이 확인된 날짜로 표시되어 있지 않습니다. 원문 날짜를 확인해 주세요."
        )
    complete_information = bool(tasks) and not unknown and not truncated
    return DeadlineReadiness(
        deadline_id=deadline.id,
        assessed_at=at,
        target_at=target,
        uses_safety_deadline=deadline.safe_due_at is not None,
        status=state,
        reasons=reasons,
        task_count=len(tasks),
        completed_count=len(tasks) - len(pending),
        unknown_task_count=unknown,
        known_required_minutes=required,
        required_minutes=required if complete_information else None,
        planned_minutes=planned,
        unplanned_minutes=max(0, required - planned) if complete_information else None,
        remaining_minutes=remaining,
        truncated=truncated,
    )
