"""Read-only, bounded capacity and prerequisite checks against the visible calendar."""

from datetime import UTC, datetime, timedelta
from math import ceil
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import load_only

from app.models import Deadline, ScheduledEvent, Task
from app.schemas.capacity_risk import CapacityRisk
from app.services import auto_schedule as schedule
from app.services import availability, task_dependencies
from app.services.recurrence import occurrences, utc

MAX_TASKS = 200
MAX_CALENDAR_ROWS = 1000
MAX_OCCURRENCES = 2000
TASK_FIELDS = (
    Task.id,
    Task.user_id,
    Task.deadline_id,
    Task.title,
    Task.is_completed,
    Task.completed_at,
    Task.recurrence,
    Task.series_id,
    Task.excluded_starts,
    Task.estimated_minutes,
    Task.priority,
    Task.schedule_type,
    Task.earliest_start,
    Task.latest_end,
    Task.updated_at,
)


def horizon(at, target):
    return at + timedelta(days=31) if target - at > timedelta(days=31) else target


def minute_count(intervals):
    return int(sum((b - a).total_seconds() for a, b in schedule.merge(intervals)) // 60)


def intersect(intervals, windows):
    return schedule.merge(
        [
            (max(a, c), min(b, d))
            for a, b in intervals
            for c, d in windows
            if max(a, c) < min(b, d)
        ]
    )


def calendar(db, owner, at, end):
    placed = exists().where(
        ScheduledEvent.task_id == Task.id, ScheduledEvent.user_id == owner
    )
    fixed = list(
        db.scalars(
            select(Task)
            .options(load_only(*TASK_FIELDS))
            .where(
                Task.user_id == owner,
                Task.schedule_type == "fixed",
                Task.earliest_start.is_not(None),
                Task.latest_end.is_not(None),
                Task.latest_end > Task.earliest_start,
                Task.earliest_start < end,
                or_(Task.latest_end > at, Task.recurrence.is_not(None)),
                ~placed,
            )
            .order_by(Task.id)
            .limit(MAX_CALENDAR_ROWS + 1)
        )
    )
    rows = db.execute(
        select(ScheduledEvent.task_id, ScheduledEvent.start_at, ScheduledEvent.end_at)
        .join(Task, Task.id == ScheduledEvent.task_id)
        .where(
            ScheduledEvent.user_id == owner,
            Task.user_id == owner,
            ScheduledEvent.status.in_(["approved", "synced"]),
            ScheduledEvent.start_at < end,
            ScheduledEvent.end_at > at,
        )
        .order_by(ScheduledEvent.id)
        .limit(MAX_CALENDAR_ROWS + 1)
    ).all()
    incomplete = len(fixed) > MAX_CALENDAR_ROWS or len(rows) > MAX_CALENDAR_ROWS
    intervals = [
        (r.task_id, max(at, utc(r.start_at)), min(end, utc(r.end_at)))
        for r in rows[:MAX_CALENDAR_ROWS]
    ]
    count = 0
    for task in fixed[:MAX_CALENDAR_ROWS]:
        try:
            spans = occurrences(
                task.earliest_start,
                task.latest_end,
                task.recurrence,
                at,
                end,
                MAX_OCCURRENCES - count + 1,
                excluded=task.excluded_starts,
            )
        except (ValueError, OverflowError):
            incomplete = True
            continue
        for a, b in spans:
            if count >= MAX_OCCURRENCES:
                incomplete = True
                break
            intervals.append((task.id, max(at, a), min(end, b)))
            count += 1
        if count >= MAX_OCCURRENCES:
            incomplete = True
            break
    if any(a >= b for _, a, b in intervals):
        incomplete = True
    return [(i, a, b) for i, a, b in intervals if a < b], incomplete


def expand(db, owner, tasks):
    rows = task_dependencies.edges(db, owner)
    mapping = {}
    for child, parent in rows:
        mapping.setdefault(child, []).append(parent)
    by_id = {t.id: t for t in tasks}
    parent_ids = {p for _, p in rows} - by_id.keys()
    if parent_ids:
        by_id.update(
            {
                t.id: t
                for t in db.scalars(
                    select(Task)
                    .options(load_only(*TASK_FIELDS))
                    .where(Task.user_id == owner, Task.id.in_(parent_ids))
                )
            }
        )
    ids = {t.id for t in tasks}
    stack = [t.id for t in tasks if not t.is_completed]
    seen = set()
    while stack:
        child = stack.pop()
        if child in seen:
            continue
        seen.add(child)
        for parent in mapping.get(child, []):
            if parent not in by_id:
                raise HTTPException(409, "연결된 선행 작업을 확인하지 못했습니다.")
            if parent not in ids:
                ids.add(parent)
                if not by_id[parent].is_completed:
                    stack.append(parent)
        if len(ids) > MAX_TASKS:
            raise HTTPException(
                409, "선행 작업이 많아 전체 순서를 확인하지 못했습니다."
            )
    expanded = [by_id[i] for i in ids]
    effective = {
        t.id: [] if t.is_completed else mapping.get(t.id, []) for t in expanded
    }
    ordered = task_dependencies.order(
        expanded,
        effective,
        lambda t: (
            utc(t.latest_end) if t.latest_end else datetime.max.replace(tzinfo=UTC),
            -t.priority,
            str(t.id),
        ),
    )
    return ordered, effective, len(ids - {t.id for t in tasks})


def estimate(task):
    if task.recurrence or task.series_id:
        return None
    if task.estimated_minutes and task.estimated_minutes > 0:
        return task.estimated_minutes
    if task.schedule_type == "fixed" and task.earliest_start and task.latest_end:
        return (
            max(
                0,
                ceil(
                    (utc(task.latest_end) - utc(task.earliest_start)).total_seconds()
                    / 60
                ),
            )
            or None
        )
    return None


def allocate(free, begin, end, needed):
    result = []
    for left, right in free:
        start = max(left, begin)
        rounded = start.replace(second=0, microsecond=0)
        if start > rounded:
            rounded += timedelta(minutes=1)
        start = rounded + timedelta(minutes=(-rounded.minute) % 5)
        stop = min(right, end)
        while start < stop and needed:
            amount = min(60, needed, int((stop - start).total_seconds() // 60))
            if amount <= 0 or (amount < 15 and needed > amount):
                break
            finish = start + timedelta(minutes=amount)
            result.append((start, finish))
            needed -= amount
            start = finish
        if not needed:
            return result
    return None


def assess(
    db,
    owner,
    deadline,
    tasks,
    at,
    *,
    truncated=False,
    include_google=False,
    google_busy=(),
    google_state="excluded",
    google_incomplete=False,
):
    target = utc(deadline.safe_due_at or deadline.due_at)
    end = horizon(at, target)
    result = CapacityRisk(
        level="unknown",
        checked_until=end,
        includes_google=include_google,
        google_state=google_state,
        reasons=[],
    )
    if tasks and all(t.is_completed for t in tasks) and not truncated:
        result.level = "completed"
        result.required_minutes = result.to_schedule_minutes = (
            result.unplaced_minutes
        ) = result.reserved_minutes = 0
        result.reasons = ["연결된 할 일이 모두 완료로 표시되어 있습니다."]
        return result
    if utc(deadline.due_at) <= at:
        result.level = "overdue"
        result.reasons = ["공식 마감 시각이 지났습니다."]
        return result
    if target <= at:
        result.level = "attention"
        result.reasons = [
            "안전 마감 시각이 지났습니다. 공식 마감 전에 계획을 다시 확인해 주세요."
        ]
        return result
    if not tasks:
        result.reasons = ["연결된 할 일이 없어 필요한 작업 시간을 확인할 수 없습니다."]
        return result
    result.incomplete = truncated or google_incomplete or end < target
    if end < target:
        result.reasons.append(
            "앞으로 31일까지만 확인했습니다. 그 이후까지의 여유는 판단을 보류합니다."
        )
    try:
        ordered, parents, result.prerequisite_count = expand(db, owner, tasks)
    except HTTPException as error:
        result.incomplete = True
        result.reasons.append(error.detail)
        return result
    spans, partial = calendar(db, owner, at, end)
    result.incomplete |= partial
    windows = schedule.working_windows(
        SimpleNamespace(start_at=at, end_at=end, use_saved_availability=True),
        availability.read(db, owner),
    )
    free = schedule.subtract(
        windows, schedule.merge([(a, b) for _, a, b in spans] + list(google_busy))
    )
    result.working_minutes = minute_count(windows)
    result.free_minutes = minute_count(free)
    deadlines = {
        d.id: d
        for d in db.scalars(
            select(Deadline)
            .options(
                load_only(
                    Deadline.id,
                    Deadline.user_id,
                    Deadline.due_at,
                    Deadline.safety_buffer_minutes,
                )
            )
            .where(
                Deadline.user_id == owner,
                Deadline.id.in_({t.deadline_id for t in ordered if t.deadline_id}),
            )
        )
    }
    unknown = False
    constraint = False
    proven_shortage = False
    shortage_reasons = set()
    required = reserved = remaining = unplaced = upper_reserved = 0
    finishes = {}
    lower = {}
    simulation_free = free
    active = db.execute(
        select(ScheduledEvent.task_id, ScheduledEvent.start_at, ScheduledEvent.end_at)
        .where(
            ScheduledEvent.user_id == owner,
            ScheduledEvent.task_id.in_([t.id for t in ordered]),
            ScheduledEvent.status.in_(["approved", "synced"]),
        )
        .order_by(ScheduledEvent.id)
        .limit(MAX_CALENDAR_ROWS + 1)
    ).all()
    result.incomplete |= len(active) > MAX_CALENDAR_ROWS
    for task in ordered:
        if task.is_completed:
            finishes[task.id] = lower[task.id] = (
                utc(task.completed_at) if task.completed_at else at
            )
            continue
        work = estimate(task)
        if work is None:
            unknown = True
            continue
        required += work
        own_deadline = deadlines.get(task.deadline_id)
        if task.deadline_id and not own_deadline:
            unknown = True
        limit = min(
            end,
            utc(task.latest_end) if task.latest_end else end,
            utc(own_deadline.safe_due_at or own_deadline.due_at)
            if own_deadline
            else end,
        )
        begin = max(at, utc(task.earliest_start) if task.earliest_start else at)
        if any(
            r.task_id == task.id and (utc(r.start_at) < begin or utc(r.end_at) > limit)
            for r in active[:MAX_CALENDAR_ROWS]
        ):
            constraint = True
        own = schedule.merge(
            [(a, b) for identity, a, b in spans if identity == task.id]
        )
        possible = intersect(own, [(begin, limit)]) if begin < limit else []
        if task.schedule_type == "flexible":
            possible = intersect(possible, windows)
        valid = schedule.subtract(
            possible,
            schedule.merge(
                [(a, b) for identity, a, b in spans if identity != task.id]
                + list(google_busy)
            ),
        )
        upper_reserved += min(work, minute_count(valid))
        if minute_count(valid) < minute_count(possible):
            constraint = True
        if minute_count(possible) < minute_count(intersect(own, [(at, end)])):
            constraint = True
        # Optimistic bounds prove lack of time; a greedy simulation failure alone never does.
        prerequisites = parents.get(task.id, [])
        optimistic = max([begin, *(lower[p] for p in prerequisites if p in lower)])
        if all(p in lower for p in prerequisites):
            if work > max(0, int((limit - optimistic).total_seconds() // 60)):
                proven_shortage = True
                shortage_reasons.add(
                    "선행 작업을 순서대로 끝내기에는 작업의 완료 기한이 너무 가깝습니다."
                    if prerequisites
                    else "일부 작업의 시작·완료 기한 사이 시간이 예상 소요시간보다 짧습니다."
                )
            else:
                lower[task.id] = optimistic + timedelta(minutes=work)
        upper = (
            minute_count(intersect(free, [(begin, limit)]))
            + min(work, minute_count(valid))
            if begin < limit
            else 0
        )
        if work > upper and end == target:
            proven_shortage = True
            shortage_reasons.add(
                "일부 작업은 정해 둔 가능 기간 안에 필요한 빈 시간을 확보할 수 없습니다."
            )
        if not all(p in finishes for p in prerequisites):
            remaining += work
            unplaced += work
            constraint = True
            continue
        earliest = max([begin, *(finishes[p] for p in prerequisites)])
        before_order = minute_count(valid)
        valid = intersect(valid, [(earliest, limit)]) if earliest < limit else []
        if minute_count(valid) < before_order:
            constraint = True
        covered = min(work, minute_count(valid))
        reserved += covered
        need = work - covered
        remaining += need
        if not need:
            finishes[task.id] = max(b for _, b in valid)
            continue
        if task.schedule_type != "flexible":
            constraint = True
            unplaced += need
            continue
        proposed = allocate(simulation_free, earliest, limit, need)
        if proposed is None:
            unplaced += need
            continue
        simulation_free = schedule.subtract(simulation_free, proposed)
        finishes[task.id] = max([b for _, b in proposed] + [b for _, b in valid])
    result.known_required_minutes = required
    complete = not unknown and not result.incomplete
    result.reserved_minutes = reserved
    result.required_minutes = required if complete else None
    result.to_schedule_minutes = remaining if complete else None
    result.unplaced_minutes = unplaced if complete else None
    if required > result.free_minutes + upper_reserved and end == target:
        proven_shortage = True
        shortage_reasons.add(
            "남은 작업량이 실제 빈 시간과 유효한 기존 배치 시간을 합친 것보다 많습니다."
        )
    if result.incomplete:
        result.free_minutes = result.reserved_minutes = None
        result.level = "unknown"
        result.reasons.append(
            "일정이나 선행 작업을 모두 확인하지 못해 여유 여부를 판단하지 않았습니다."
        )
    elif proven_shortage:
        result.level = "insufficient"
        result.reasons.append(
            "현재 가능 시간과 등록 일정을 유지하면 기한 안에 필요한 작업 시간을 확보할 수 없습니다."
        )
        result.reasons.extend(sorted(shortage_reasons))
    elif unknown:
        result.level = "unknown"
        result.reasons.append(
            "소요시간이 없거나 반복 중인 작업이 있어 남은 작업량을 확인해 주세요."
        )
    elif unplaced or constraint:
        result.level = "attention"
        result.reasons.append(
            "겹치는 배치나 작업 순서·개별 기한 때문에 전체 계획을 확인하지 못했습니다. 배치를 조정해 주세요."
        )
    elif not deadline.is_confirmed:
        result.level = "attention"
        result.reasons.append(
            "배치 방법은 확인했지만 마감일이 확인된 날짜로 표시되어 있지 않습니다. 원문 날짜를 확인해 주세요."
        )
    elif minute_count(simulation_free) <= max(
        30, ceil(required * 0.2)
    ) or target - at <= timedelta(days=1):
        result.level = "tight"
        result.reasons.append(
            "확인한 범위에서 작업을 끝낼 수 있지만 남은 여유가 적습니다."
        )
    else:
        result.level = "feasible"
        result.reasons.append(
            "현재 빈 시간과 작업 순서를 기준으로 기한 안에 끝낼 수 있는 배치 방법을 확인했습니다."
        )
    if result.prerequisite_count:
        result.reasons.append(
            "다른 마감일에 연결된 작업도 먼저 해야 한다면 필요한 시간에 포함했습니다."
        )
    if not include_google:
        result.reasons.append("구글 개인 일정은 제외하고 플랜캐치 일정만 확인했습니다.")
    elif google_state == "not_connected":
        result.reasons.append(
            "구글 계정이 연결되지 않아 구글 일정을 포함하지 못했습니다. 연결하거나 포함 선택을 해제해 주세요."
        )
    elif google_state in {"partial", "unavailable"}:
        result.reasons.append(
            "구글 바쁨 일정을 모두 확인하지 못했습니다. 잠시 후 다시 확인해 주세요."
        )
    if constraint:
        result.reasons.append("이미 등록한 배치는 자동으로 옮기지 않았습니다.")
    return result
