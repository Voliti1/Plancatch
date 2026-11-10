"""Owner-scoped, bounded overlap preview for actual local calendar intervals."""
from bisect import bisect_left
from datetime import UTC, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import exists, or_, select

from app.models import GoogleCalendarConnection, ScheduledEvent, Task
from app.services.recurrence import SEOUL, occurrences, utc

MAX_ROWS = 1000
MAX_OCCURRENCES = 201
MAX_RESULTS = 20


def preview(db, user_id, request, *, now=None):
    start, end = request.start_at, request.end_at
    first = max(start, now or datetime.now(UTC)) if request.recurrence else start
    last = min(datetime.max.replace(tzinfo=UTC), first + min(
        timedelta(days=90), datetime.max.replace(tzinfo=UTC) - first))
    if not request.recurrence:
        last = min(last, end)
    rule = request.recurrence
    proposed = occurrences(start, end, rule, first, last, MAX_OCCURRENCES)
    starts = [at for at, _ in proposed]
    limited = len(proposed) == MAX_OCCURRENCES
    coverage_limited = not rule and end > last
    if rule:
        # One future result suffices to establish that the series continues beyond the preview.
        future = min(timedelta(days=36525), datetime.max.replace(tzinfo=UTC) - last)
        coverage_limited = bool(occurrences(start, end, rule, last, last + future, 1))
    placed = exists().where(ScheduledEvent.task_id == Task.id, ScheduledEvent.user_id == user_id)
    tasks = select(Task).where(Task.user_id == user_id, Task.schedule_type == "fixed",
        Task.earliest_start.is_not(None), Task.latest_end.is_not(None),
        Task.latest_end > Task.earliest_start, Task.earliest_start < last,
        or_(Task.latest_end > first, Task.recurrence.is_not(None)), ~placed)
    for identity in (request.exclude_task_id, request.placement_task_id):
        if identity:
            tasks = tasks.where(Task.id != identity)
    rows = list(db.scalars(tasks.order_by(Task.earliest_start, Task.id).limit(MAX_ROWS + 1)))
    limited = limited or len(rows) > MAX_ROWS
    events = select(ScheduledEvent, Task.title).join(Task, Task.id == ScheduledEvent.task_id).where(
        ScheduledEvent.user_id == user_id, Task.user_id == user_id,
        ScheduledEvent.status.in_(["approved", "synced"]),
        ScheduledEvent.start_at < last, ScheduledEvent.end_at > first)
    if request.exclude_task_id:
        events = events.where(ScheduledEvent.task_id != request.exclude_task_id)
    if request.exclude_event_id:
        events = events.where(ScheduledEvent.id != request.exclude_event_id)
    blocks = list(db.execute(events.order_by(ScheduledEvent.start_at, ScheduledEvent.id).limit(MAX_ROWS + 1)))
    limited = limited or len(blocks) > MAX_ROWS
    matches = []

    def add(kind, identity, task_id, title, at, finish, recurring=False, all_day=False):
        nonlocal limited
        index = bisect_left(starts, finish) - 1
        if index >= 0 and proposed[index][1] > at:
            if len(matches) > MAX_RESULTS:
                limited = True
                return
            matches.append({"kind":kind,"id":identity,"task_id":task_id,"title":title,
                "start_at":at,"end_at":finish,"proposed_start_at":proposed[index][0],
                "proposed_end_at":proposed[index][1],"is_recurring":recurring,"is_all_day":all_day})

    for task in rows[:MAX_ROWS]:
        dates = occurrences(task.earliest_start, task.latest_end, task.recurrence, first, last,
                            MAX_OCCURRENCES, excluded=task.excluded_starts)
        limited = limited or len(dates) == MAX_OCCURRENCES
        for at, finish in dates:
            if task.id == request.exclude_occurrence_task_id and at == request.exclude_occurrence_start:
                continue
            add("task", task.id, task.id, task.title, at, finish, bool(task.recurrence))
    for event, title in blocks[:MAX_ROWS]:
        add("event", event.id, event.task_id, title, utc(event.start_at), utc(event.end_at))
    google_state, google_message = "not_connected", None
    if proposed and db.get(GoogleCalendarConnection, user_id) is not None:
        # The shared reader refreshes credentials once, never writes an event and
        # marks only copies bound to this owner's current connection as local.
        from app.api.routes.google_calendar import read_owned_calendar
        try:
            page = read_owned_calendar(user_id, db, first, last)
            google_state = "partial" if page.has_more or page.skipped_count else "checked"
            if google_state == "partial":
                google_message = "구글 일정이 많거나 읽지 못한 항목이 있어 일부만 확인했습니다. 다른 겹침이 있을 수 있습니다."
            for item in page.events:
                if not item.busy or item.local_item_id is not None:
                    continue
                try:
                    at = item.start_at or datetime.combine(item.start_date, time(), SEOUL).astimezone(UTC)
                    finish = item.end_at or datetime.combine(item.end_date, time(), SEOUL).astimezone(UTC)
                except (TypeError, OverflowError):
                    google_state = "partial"
                    google_message = "시간을 확인하지 못한 구글 일정이 있습니다. 다른 겹침이 있을 수 있습니다."
                    continue
                add("google", item.id, None, item.title, utc(at), utc(finish), bool(item.recurring_event_id), item.start_date is not None)
        except HTTPException as error:
            if error.status_code in {401, 403}:
                raise
            google_state = "reconnect_required" if error.status_code == 409 else "unavailable"
            google_message = str(error.detail)
    matches.sort(key=lambda row: (row['start_at'], row['kind'], str(row['id'])))
    return {"conflicts":matches[:MAX_RESULTS],"truncated":limited or len(matches)>MAX_RESULTS,
        "checked_from":first,"checked_until":last,
        "is_recurring":bool(rule),"scope":"local_and_google_primary" if google_state != "not_connected" else "local",
        "google_state":google_state,"google_message":google_message,"coverage_limited":coverage_limited}
