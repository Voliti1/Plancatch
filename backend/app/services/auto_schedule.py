"""Bounded earliest-deadline planning, with atomic local approval and durable retries."""

import hashlib
import json
import uuid
from datetime import UTC, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, exists, or_, select

from app.models import (
    Deadline,
    GoogleCalendarConnection,
    ScheduledEvent,
    SchedulePlan,
    Task,
)
from app.schemas.schedule_plan import PreviewInput
from app.services import google_sync as sync
from app.services.recurrence import SEOUL, occurrences, utc

MAX_ROWS = 1000
MAX_BLOCKS = 200


def now():
    return datetime.now(UTC)


def stamp(value):
    return utc(value).isoformat() if value else None


def connection_binding(db, owner):
    row = db.get(GoogleCalendarConnection, owner)
    return stamp(row.connected_at) if row else None


def selected_tasks(db, owner, ids):
    tasks = list(
        db.scalars(
            select(Task)
            .where(Task.user_id == owner, Task.id.in_(ids))
            .order_by(Task.id)
        )
    )
    if len(tasks) != len(ids):
        raise HTTPException(
            404, "선택한 할 일을 찾을 수 없습니다. 목록을 다시 확인해 주세요."
        )
    return tasks


def merge(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result


def subtract(free, busy):
    result = []
    for start, end in free:
        cursor = start
        for left, right in busy:
            if right <= cursor:
                continue
            if left >= end:
                break
            if left > cursor:
                result.append((cursor, min(left, end)))
            cursor = max(cursor, right)
            if cursor >= end:
                break
        if cursor < end:
            result.append((cursor, end))
    return result


def working_windows(request):
    try:
        first = request.start_at.astimezone(SEOUL).date()
        last = request.end_at.astimezone(SEOUL).date()
        result = []
        for offset in range((last - first).days + 1):
            day = first + timedelta(days=offset)
            if day.weekday() not in request.weekdays:
                continue
            midnight = datetime.combine(day, time(), SEOUL).astimezone(UTC)
            begin = max(
                request.start_at,
                midnight + timedelta(minutes=request.day_start_minutes),
            )
            end = min(
                request.end_at, midnight + timedelta(minutes=request.day_end_minutes)
            )
            if begin < end:
                result.append((begin, end))
        return result
    except (ValueError, OverflowError):
        raise HTTPException(422, "작업 날짜 범위를 확인해 주세요.") from None


def external_busy(db, owner, request):
    bound = connection_binding(db, owner) if request.include_google else None
    details = {
        "google_state": "not_connected" if request.include_google else "excluded",
        "warnings": [],
        "blocked": False,
    }
    if not bound:
        return [], details, bound
    from app.api.routes.google_calendar import read_owned_calendar

    try:
        page = read_owned_calendar(owner, db, request.start_at, request.end_at)
        details["google_state"] = (
            "partial" if page.has_more or page.skipped_count else "checked"
        )
        if page.has_more or page.skipped_count:
            details["blocked"] = True
            details["warnings"].append(
                "구글 일정을 일부만 확인했습니다. 기간을 줄이거나 구글 제외를 선택한 뒤 다시 미리보기를 만들어 주세요."
            )
        intervals = []
        for item in page.events:
            if not item.busy or item.local_item_id is not None:
                continue
            try:
                start = item.start_at or datetime.combine(
                    item.start_date, time(), SEOUL
                ).astimezone(UTC)
                end = item.end_at or datetime.combine(
                    item.end_date, time(), SEOUL
                ).astimezone(UTC)
                intervals.append((utc(start), utc(end)))
            except (ValueError, TypeError, OverflowError):
                details["blocked"] = True
                details["warnings"].append(
                    "시간을 확인하지 못한 구글 일정이 있습니다. 기간을 줄여 다시 확인해 주세요."
                )
        return intervals, details, bound
    except HTTPException as error:
        if error.status_code in {401, 403}:
            raise
        details.update(google_state="unavailable", blocked=True)
        details["warnings"].append(
            "구글 일정을 확인하지 못했습니다. 연결 상태를 확인하거나 구글 제외를 선택한 뒤 다시 미리보기를 만들어 주세요."
        )
        return [], details, bound


def local_state(db, owner, request):
    tasks = selected_tasks(db, owner, request.task_ids)
    deadlines = {
        d.id: d
        for d in db.scalars(
            select(Deadline).where(
                Deadline.user_id == owner,
                Deadline.id.in_([t.deadline_id for t in tasks if t.deadline_id]),
            )
        )
    }
    placed_ids = set(
        db.scalars(
            select(ScheduledEvent.task_id)
            .where(
                ScheduledEvent.user_id == owner,
                ScheduledEvent.task_id.in_(request.task_ids),
                ScheduledEvent.status.in_(["approved", "synced"]),
            )
            .distinct()
        )
    )
    originals = []
    replacement_rows = []
    replacement_incomplete = False
    if request.replace_existing:
        originals = list(
            db.scalars(
                select(ScheduledEvent)
                .where(
                    ScheduledEvent.user_id == owner,
                    ScheduledEvent.task_id.in_(request.task_ids),
                    ScheduledEvent.status.in_(["approved", "synced"]),
                )
                .order_by(ScheduledEvent.id)
                .limit(MAX_BLOCKS + 1)
            )
        )
        replacement_incomplete = len(originals) > MAX_BLOCKS
        if not replacement_incomplete:
            for task in tasks:
                rows = [e for e in originals if e.task_id == task.id]
                if (
                    task.schedule_type == "flexible"
                    and not task.recurrence
                    and not task.series_id
                    and not task.is_completed
                    and task.estimated_minutes
                    and rows
                    and all(replaceable(e) for e in rows)
                ):
                    replacement_rows.extend(rows)
    replacement_ids = {e.id for e in replacement_rows}
    placed = exists().where(
        ScheduledEvent.task_id == Task.id, ScheduledEvent.user_id == owner
    )
    fixed = list(
        db.scalars(
            select(Task)
            .where(
                Task.user_id == owner,
                Task.schedule_type == "fixed",
                Task.earliest_start.is_not(None),
                Task.latest_end.is_not(None),
                Task.latest_end > Task.earliest_start,
                Task.earliest_start < request.end_at,
                or_(Task.latest_end > request.start_at, Task.recurrence.is_not(None)),
                ~placed,
            )
            .order_by(Task.id)
            .limit(MAX_ROWS + 1)
        )
    )
    events = list(
        db.execute(
            select(ScheduledEvent)
            .join(Task, Task.id == ScheduledEvent.task_id)
            .where(
                ScheduledEvent.user_id == owner,
                Task.user_id == owner,
                ScheduledEvent.status.in_(["approved", "synced"]),
                ScheduledEvent.id.not_in(replacement_ids),
                ScheduledEvent.start_at < request.end_at,
                ScheduledEvent.end_at > request.start_at,
            )
            .order_by(ScheduledEvent.id)
            .limit(MAX_ROWS + 1)
        ).scalars()
    )
    incomplete = (
        replacement_incomplete or len(fixed) > MAX_ROWS or len(events) > MAX_ROWS
    )
    busy = [(utc(e.start_at), utc(e.end_at)) for e in events[:MAX_ROWS]]
    for task in fixed[:MAX_ROWS]:
        try:
            dates = occurrences(
                task.earliest_start,
                task.latest_end,
                task.recurrence,
                request.start_at,
                request.end_at,
                MAX_ROWS + 1,
                excluded=task.excluded_starts,
            )
            incomplete = incomplete or len(dates) > MAX_ROWS
            busy.extend(merge(dates[:MAX_ROWS]))
        except (ValueError, OverflowError):
            incomplete = True
    sources = []
    limits = {}
    for task in tasks:
        deadline = deadlines.get(task.deadline_id)
        limit = min(
            request.end_at,
            utc(task.latest_end) if task.latest_end else request.end_at,
            utc(deadline.safe_due_at or deadline.due_at)
            if deadline
            else request.end_at,
        )
        begin = max(
            request.start_at,
            utc(task.earliest_start) if task.earliest_start else request.start_at,
        )
        limits[task.id] = (begin, limit)
        sources.append(
            {
                "id": str(task.id),
                "updated_at": stamp(task.updated_at),
                "title": task.title,
                "type": task.schedule_type,
                "recurrence": task.recurrence,
                "series": str(task.series_id),
                "completed": task.is_completed,
                "minutes": task.estimated_minutes,
                "priority": task.priority,
                "begin": stamp(begin),
                "limit": stamp(limit),
                "placed": task.id in placed_ids,
                "deadline": str(task.deadline_id),
                "deadline_exists": bool(deadline),
            }
        )
    state = {
        "tasks": sources,
        "busy": [(stamp(a), stamp(b)) for a, b in merge(busy)],
        "incomplete": incomplete,
        "google_binding": connection_binding(db, owner)
        if request.include_google
        else None,
    }
    if request.replace_existing:
        state["replacement_deadlines"] = [
            {
                "id": str(d.id),
                "due_at": stamp(d.due_at),
                "safe_due_at": stamp(d.safe_due_at),
            }
            for d in sorted(deadlines.values(), key=lambda d: str(d.id))
        ]
        # All selected placements, including those outside the new period, must
        # remain identical until approval. Do not expose provider IDs in plans.
        state["replacement_snapshot"] = [
            {
                "id": str(e.id),
                "task_id": str(e.task_id),
                "start_at": stamp(e.start_at),
                "end_at": stamp(e.end_at),
                "status": e.status,
                "approved": e.is_user_approved,
                "legacy_google": bool(e.google_event_id),
                "updated_at": stamp(e.updated_at),
            }
            for e in originals
        ]
    digest = hashlib.sha256(
        json.dumps(state, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()
    return (
        tasks,
        deadlines,
        placed_ids,
        limits,
        merge(busy),
        incomplete,
        digest,
        replacement_rows,
    )


def replaceable(event):
    return (
        event.status == "approved"
        and event.is_user_approved
        and not event.google_event_id
        and utc(event.start_at) > now()
    )


def plan_response(plan):
    return {
        "id": plan.id,
        "request": plan.request,
        "blocks": plan.blocks,
        "details": plan.details,
        "expires_at": plan.expires_at,
        "approved_at": plan.approved_at,
        "approved_event_ids": plan.approved_event_ids or [],
    }


def preview(db, owner, request):
    selected_tasks(
        db, owner, request.task_ids
    )  # Reject foreign references before any provider request.
    google_busy, details, bound = external_busy(db, owner, request)
    db.expire_all()
    sync.lock_owner(db, owner)
    tasks, deadlines, placed, limits, local_busy, incomplete, digest, replacements = (
        local_state(db, owner, request)
    )
    if incomplete:
        details["blocked"] = True
        details["warnings"].append(
            "기존 일정을 모두 확인하지 못했습니다. 조회 기간을 줄여 다시 미리보기를 만들어 주세요."
        )
    if request.include_google and bound != connection_binding(db, owner):
        details["blocked"] = True
        details["warnings"].append(
            "구글 연결이 바뀌었습니다. 다시 미리보기를 만들어 주세요."
        )
    moment = now()
    available = [(max(a, moment), b) for a, b in working_windows(request) if b > moment]
    free = subtract(available, merge([*local_busy, *google_busy]))
    plan = SchedulePlan(
        id=uuid.uuid4(),
        user_id=owner,
        # Old releases can still read this request. Replacement intent lives in
        # details; their old snapshot check rejects unapproved replacement plans.
        request=request.model_dump(mode="json", exclude={"replace_existing"}),
        snapshot_hash=digest,
        blocks=[],
        details={},
        expires_at=moment + timedelta(minutes=15),
    )
    blocks, skipped, summaries = [], [], []
    retained = {e.id: e for e in replacements}
    replacing = {e.task_id for e in replacements}
    for task in sorted(tasks, key=lambda t: (limits[t.id][1], -t.priority, str(t.id))):
        reason = None
        if task.schedule_type != "flexible" or task.recurrence or task.series_id:
            reason = "시간이 정해지지 않은 유동 작업만 자동 배치할 수 있습니다."
        elif task.is_completed:
            reason = "이미 완료한 할 일입니다."
        elif request.replace_existing and task.id not in replacing:
            reason = (
                "아직 시작하지 않은 확정 배치가 있는 유동 할 일만 재배치할 수 있습니다."
            )
        elif task.id in placed and not request.replace_existing:
            reason = "이미 확정된 배치가 있는 할 일입니다."
        elif not task.estimated_minutes:
            reason = "소요시간을 입력해 주세요."
        elif task.deadline_id and task.deadline_id not in deadlines:
            reason = "연결된 마감일을 확인해 주세요."
        begin, end = limits[task.id]
        summaries.append(
            {
                "id": str(task.id),
                "title": task.title,
                "minutes": task.estimated_minutes,
                "priority": task.priority,
                "limit": stamp(end),
                "uses_safety_deadline": bool(
                    task.deadline_id in deadlines
                    and deadlines[task.deadline_id].safe_due_at
                ),
            }
        )
        proposed = []
        remaining = task.estimated_minutes or 0
        if not reason:
            # Until each task has a complete replacement, retain other tasks'
            # old slots. An unplaceable task never loses its original times.
            task_free = subtract(
                free,
                merge(
                    [
                        (utc(e.start_at), utc(e.end_at))
                        for e in retained.values()
                        if e.task_id != task.id
                    ]
                ),
            )
            for left, right in task_free:
                at = max(left, begin)
                rounded = at.replace(second=0, microsecond=0)
                if at > rounded:
                    rounded += timedelta(minutes=1)
                at = rounded + timedelta(minutes=(-rounded.minute) % 5)
                finish = min(right, end)
                while at < finish and remaining:
                    minutes = min(
                        request.chunk_minutes,
                        remaining,
                        int((finish - at).total_seconds() // 60),
                    )
                    if minutes <= 0 or (minutes < 15 and remaining > minutes):
                        break
                    until = at + timedelta(minutes=minutes)
                    proposed.append((at, until))
                    remaining -= minutes
                    at = until
                    if len(proposed) + len(blocks) > MAX_BLOCKS:
                        reason = "배치 건수가 많습니다. 기간이나 선택한 할 일을 나누어 주세요."
                        break
                if remaining == 0 or reason:
                    break
            if remaining and not reason:
                reason = "가능 기간과 마감일 안에 소요시간 전체를 배치할 빈 시간이 부족합니다."
        if reason:
            skipped.append(
                {"task_id": str(task.id), "title": task.title, "reason": reason}
            )
            continue
        free = subtract(free, merge(proposed))
        retained = {key: e for key, e in retained.items() if e.task_id != task.id}
        for a, b in proposed:
            blocks.append(
                {
                    "id": str(uuid.uuid5(plan.id, str(len(blocks)))),
                    "task_id": str(task.id),
                    "title": task.title,
                    "start_at": stamp(a),
                    "end_at": stamp(b),
                }
            )
    details.update(unplaced=skipped, tasks=summaries)
    if request.replace_existing:
        details.update(
            replace_existing=True,
            replaced_blocks=[
                {
                    "id": str(e.id),
                    "task_id": str(e.task_id),
                    "title": next(t.title for t in tasks if t.id == e.task_id),
                    "start_at": stamp(e.start_at),
                    "end_at": stamp(e.end_at),
                }
                for e in sorted(
                    replacements, key=lambda e: (utc(e.start_at), str(e.id))
                )
            ],
        )
    plan.blocks, plan.details = blocks, details
    # Keep recent expired previews visible in history; the same 30-record cap applies.
    old_ids = list(
        db.scalars(
            select(SchedulePlan.id)
            .where(SchedulePlan.user_id == owner, SchedulePlan.approved_at.is_(None))
            .order_by(SchedulePlan.expires_at.desc(), SchedulePlan.id)
            .offset(29)
        )
    )
    if old_ids:
        db.execute(
            delete(SchedulePlan).where(
                SchedulePlan.user_id == owner, SchedulePlan.id.in_(old_ids)
            )
        )
    db.add(plan)
    db.commit()
    return plan_response(plan)


def owned_plan(db, owner, identity, *, lock=False):
    query = (
        select(SchedulePlan)
        .where(SchedulePlan.id == identity, SchedulePlan.user_id == owner)
        .execution_options(populate_existing=True)
    )
    plan = db.scalar(query.with_for_update() if lock else query)
    if not plan:
        raise HTTPException(404, "미리보기를 찾을 수 없습니다. 새로 만들어 주세요.")
    return plan


def approve(db, owner, identity, payload):
    plan = owned_plan(db, owner, identity)
    if plan.approved_at:
        return plan_response(
            plan
        )  # Receipt survives event edits/deletion; never recreates them on retry.
    if utc(plan.expires_at) <= now():
        raise HTTPException(409, "미리보기 유효 시간이 지났습니다. 다시 만들어 주세요.")
    if plan.details["blocked"]:
        raise HTTPException(
            409,
            "일정을 전부 확인하지 못했습니다. 설정을 바꾸고 다시 미리보기를 만들어 주세요.",
        )
    request = PreviewInput.model_validate(
        {**plan.request, "replace_existing": bool(plan.details.get("replace_existing"))}
    )
    google_busy, details, bound = external_busy(db, owner, request)
    db.expire_all()
    sync.lock_owner(db, owner)
    plan = owned_plan(db, owner, identity, lock=True)
    if plan.approved_at:
        return plan_response(plan)
    if utc(plan.expires_at) <= now():
        raise HTTPException(409, "미리보기 유효 시간이 지났습니다. 다시 만들어 주세요.")
    tasks, _, placed, limits, busy, incomplete, digest, replacements = local_state(
        db, owner, request
    )
    if digest != plan.snapshot_hash:
        raise HTTPException(
            409, "할 일이나 기존 일정이 변경됐습니다. 새 미리보기를 만들어 주세요."
        )
    if (
        plan.details["blocked"]
        or details["blocked"]
        or incomplete
        or (request.include_google and bound != connection_binding(db, owner))
    ):
        raise HTTPException(
            409,
            "일정을 전부 확인하지 못했습니다. 조회 기간이나 구글 포함 설정을 바꾸고 다시 미리보기를 만들어 주세요.",
        )
    expected = {block["id"]: block for block in plan.blocks}
    edited = {str(block.id): block for block in payload.blocks}
    if len(edited) != len(payload.blocks) or set(edited) - set(expected):
        raise HTTPException(422, "미리보기에 있는 배치만 한 번씩 선택해 주세요.")
    selected = {expected[key]["task_id"] for key in edited}
    if any(
        (block["task_id"] in selected) != (key in edited)
        for key, block in expected.items()
    ):
        raise HTTPException(
            422, "한 할 일의 배치는 모두 함께 선택하거나 제외해 주세요."
        )
    busy.extend(
        (utc(e.start_at), utc(e.end_at))
        for e in replacements
        if str(e.task_id) not in selected
    )
    windows = working_windows(request)
    intervals, saved = [], []
    for key, block in edited.items():
        original = expected[key]
        start, end = utc(block.start_at), utc(block.end_at)
        task_id = uuid.UUID(original["task_id"])
        low, high = limits[task_id]
        if start < now():
            raise HTTPException(
                409,
                "제안한 시작 시간이 지났습니다. 시간을 뒤로 옮기거나 새 미리보기를 만들어 주세요.",
            )
        if (
            end - start
            != datetime.fromisoformat(original["end_at"])
            - datetime.fromisoformat(original["start_at"])
            or start < low
            or end > high
            or not any(a <= start < end <= b for a, b in windows)
        ):
            raise HTTPException(
                422,
                "배치 길이를 유지하고 작업 시간·가능 기간·마감일 안으로 옮겨 주세요.",
            )
        if any(start < b and end > a for a, b in [*busy, *google_busy, *intervals]):
            raise HTTPException(
                409,
                "새 배치가 기존 일정이나 다른 배치와 겹칩니다. 시간을 바꾸거나 다시 미리보기를 만들어 주세요.",
            )
        intervals.append((start, end))
        saved.append({**original, "start_at": stamp(start), "end_at": stamp(end)})
    by_id = {str(task.id): task for task in tasks}
    for task_id in selected:
        total = sum(
            (
                datetime.fromisoformat(b["end_at"])
                - datetime.fromisoformat(b["start_at"])
            ).total_seconds()
            for b in saved
            if b["task_id"] == task_id
        )
        if (
            total != by_id[task_id].estimated_minutes * 60
            or (by_id[task_id].id in placed and not request.replace_existing)
            or (
                request.replace_existing
                and by_id[task_id].id not in {e.task_id for e in replacements}
            )
        ):
            raise HTTPException(
                409,
                "소요시간이나 배치 상태가 달라졌습니다. 새로 미리보기를 만들어 주세요.",
            )
    for event in replacements:
        if str(event.task_id) in selected:
            if not replaceable(event):
                raise HTTPException(
                    409, "기존 배치가 시작됐습니다. 다시 미리보기를 만들어 주세요."
                )
            db.delete(event)
    for block in saved:
        db.add(
            ScheduledEvent(
                id=uuid.UUID(block["id"]),
                user_id=owner,
                task_id=uuid.UUID(block["task_id"]),
                start_at=datetime.fromisoformat(block["start_at"]),
                end_at=datetime.fromisoformat(block["end_at"]),
                status="approved",
                is_user_approved=True,
            )
        )
    db.flush()
    for task_id in selected:
        sync.enqueue_task(db, owner, uuid.UUID(task_id))
    plan.blocks = saved
    if request.replace_existing:
        plan.details = {
            **plan.details,
            "replaced_blocks": [
                block
                for block in plan.details.get("replaced_blocks", [])
                if block["task_id"] in selected
            ],
        }
    plan.approved_at = now()
    plan.approved_event_ids = [block["id"] for block in saved]
    db.commit()
    return plan_response(plan)
