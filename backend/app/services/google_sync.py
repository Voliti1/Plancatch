"""Durable latest desired calendar state, independent of a browser's lifetime."""
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import (
    Deadline,
    GoogleCalendarConnection,
    GoogleExport,
    ScheduledEvent,
    Task,
    User,
)
from app.services import google_calendar as google
from app.services import google_changes as changes
from app.services import google_events
from app.services import google_export as transport
from app.services.google_reminders import provider_value
from app.services.recurrence import google_rule

logger = logging.getLogger(__name__)


def now():
    return datetime.now(UTC)


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def digest(payload):
    return google.digest(json.dumps(payload, sort_keys=True, ensure_ascii=False))


def lock_owner(db, user_id, *, skip_locked=False):
    return db.scalar(select(User.id).where(User.id == user_id).with_for_update(skip_locked=skip_locked))


def payload(title, start, end, reminders=None):
    start, end = utc(start), utc(end)
    start = start.replace(microsecond=start.microsecond // 1000 * 1000)
    end = end.replace(microsecond=end.microsecond // 1000 * 1000)
    if end <= start:
        return None
    result = {"summary": title, "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Seoul"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Asia/Seoul"}}
    settings = provider_value(reminders)
    if settings is not None:
        result["reminders"] = settings
    return result


def enqueue(db, user_id, kind, item_id, desired, task_id=None, *, force=False):
    """Caller holds the owner lock; local change and desired state commit together."""
    connection = db.get(GoogleCalendarConnection, user_id)
    if connection is None or google.SCOPE not in connection.scopes.split():
        return
    row = db.scalar(select(GoogleExport).where(GoogleExport.user_id == user_id,
        GoogleExport.kind == kind, GoogleExport.item_id == item_id).with_for_update())
    bound = transport.binding(connection)
    if row is None:
        if desired is None:
            return
        identity = uuid.uuid4()
        row = GoogleExport(id=identity, user_id=user_id, kind=kind, item_id=item_id, task_id=task_id,
            connection_binding=bound, payload=desired, payload_hash=digest(desired),
            google_event_id="pc" + identity.hex)
        db.add(row)
    elif row.connection_binding != bound:
        row.error_code, row.sync_pending = "connection_changed", False
        return  # Never send an old account's intent to a newly connected account.
    elif not force and row.sync_pending and row.desired_payload == desired:
        return
    elif not force and not row.sync_pending and not row.error_code and not changes.pending(row):
        if (desired is None and row.deleted_at) or (desired is not None and not row.deleted_at and row.status == "sent" and digest(desired) == row.payload_hash):
            return
    row.desired_payload, row.sync_pending = desired, True
    row.sync_attempts, row.retry_at, row.error_code = 0, now(), None


def enqueue_deadline(db, user_id, item_id, *, force=False):
    db.flush()
    item = db.scalar(select(Deadline).where(Deadline.id == item_id, Deadline.user_id == user_id))
    desired = None
    if item and item.is_confirmed:
        try:
            desired = payload(item.title, item.due_at, item.due_at + timedelta(minutes=1), item.google_reminders)
        except OverflowError:
            pass  # An unrepresentable time remains local, like the manual export contract.
    enqueue(db, user_id, "deadline", item_id, desired, force=force)


def enqueue_task(db, user_id, task_id, *, force=False):
    db.flush()
    item = db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    events = list(db.scalars(select(ScheduledEvent).where(ScheduledEvent.task_id == task_id,
        ScheduledEvent.user_id == user_id)))
    desired = None
    if item and not events and item.schedule_type == "fixed" and item.earliest_start and item.latest_end:
        desired = payload(item.title, item.earliest_start, item.latest_end, item.google_reminders)
        if desired and item.recurrence:
            desired["recurrence"] = google_rule(item.recurrence, item.excluded_starts)
    enqueue(db, user_id, "task", task_id, desired, task_id, force=force)
    known = {event.id for event in events}
    for event in events:
        desired = (payload(item.title, event.start_at, event.end_at, item.google_reminders) if item and event.status == "approved"
            and event.is_user_approved and not event.google_event_id else None)
        enqueue(db, user_id, "event", event.id, desired, task_id, force=force)
    for identity in db.scalars(select(GoogleExport.item_id).where(GoogleExport.user_id == user_id,
            GoogleExport.kind == "event", GoogleExport.task_id == task_id)):
        if identity not in known:
            enqueue(db, user_id, "event", identity, None, task_id, force=force)


def failure(row, code):
    row.error_code = code
    row.sync_attempts += 1
    row.sync_pending = code in {"uncertain", "rate_limited"} and row.sync_attempts < 10
    row.retry_at = now() + timedelta(seconds=min(3600, 15 * 2 ** min(row.sync_attempts - 1, 8))) if row.sync_pending else None


def acknowledged(row, action, target=None):
    if action == "update":
        row.payload, row.payload_hash = target, digest(target)
        row.status = "sent"
    else:
        row.deleted_at, row.status = now(), "sent"
    row.revision += 1
    row.error_code = None


def process_row(db, identity):
    row = db.get(GoogleExport, identity)
    if row is None or not lock_owner(db, row.user_id, skip_locked=True):
        return
    row = db.scalar(select(GoogleExport).where(GoogleExport.id == identity).with_for_update()
        .execution_options(populate_existing=True))
    if not row.sync_pending or (row.retry_at and utc(row.retry_at) > now()):
        return
    connection = db.get(GoogleCalendarConnection, row.user_id)
    if connection is None or transport.binding(connection) != row.connection_binding:
        failure(row, "connection_changed")
        db.commit()
        return
    if google.SCOPE not in connection.scopes.split() or (connection.refresh_expires_at and utc(connection.refresh_expires_at) <= now()):
        failure(row, "access_denied")
        db.commit()
        return
    if not changes.pending(row) and ((row.deleted_at and row.desired_payload is None) or (
            not row.deleted_at and row.status == "sent" and row.desired_payload is not None and digest(row.desired_payload) == row.payload_hash)):
        row.sync_pending, row.retry_at, row.error_code = False, None, None
        db.commit()
        return
    # A fixed task and its explicit placements cannot both exist as Google copies.
    if row.task_id and row.desired_payload is not None and row.status == "pending":
        other = db.scalar(select(GoogleExport).where(GoogleExport.user_id == row.user_id,
            GoogleExport.task_id == row.task_id, GoogleExport.kind == ("event" if row.kind == "task" else "task"),
            GoogleExport.deleted_at.is_(None), GoogleExport.connection_binding == row.connection_binding).limit(1))
        if other is not None:
            if other.sync_pending and other.desired_payload is None:
                row.retry_at = now() + timedelta(seconds=1)
            else:
                failure(row, "conflict")
            db.commit()
            return
    try:
        config = google.configuration()
        refresh = google.decrypt(config, row.user_id, "refresh", connection.refresh_token_ciphertext)
        token, rotated = google_events.refresh_access(config, refresh)
        if rotated:
            connection.refresh_token_ciphertext = google.encrypt(config, row.user_id, "refresh", rotated)
        if row.status == "pending":
            if row.desired_payload is None:
                status, item = transport.request(token, "GET", row.google_event_id)
                if status in {404, 410} or item.get("status") == "cancelled":
                    acknowledged(row, "delete")
                    row.sync_pending = False
                    db.commit()
                    return
                if not transport.matches(item, row.google_event_id, row.id, row.payload):
                    raise transport.ExportError(409, "conflict")
            else:
                transport.send_once(token, row)
            row.status, row.sent_at, row.error_code = "sent", now(), None
        elif changes.pending(row):
            intent = row.mutation
            changes.change_once(token, row, intent)
            acknowledged(row, intent["action"], intent["payload"])
            row.mutation = {**intent, "state": "applied", "applied_at": now().isoformat()}
        elif row.deleted_at:
            if row.desired_payload is None:
                row.sync_pending, row.error_code = False, None
            else:
                # New durable generation after a locally acknowledged removal, never reuse a tombstone ID.
                row.google_event_id = "pc" + uuid.uuid4().hex
                row.payload, row.payload_hash = row.desired_payload, digest(row.desired_payload)
                row.status, row.deleted_at, row.mutation = "pending", None, None
                row.revision += 1
        elif row.desired_payload is not None and digest(row.desired_payload) == row.payload_hash and row.status == "sent":
            row.sync_pending, row.error_code = False, None
        else:
            action = "delete" if row.desired_payload is None else "update"
            item = changes.read_copy(token, row)
            if item is None:
                if action == "update":
                    raise transport.ExportError(409, "conflict")
                acknowledged(row, "delete")
                row.sync_pending = False
            else:
                row.mutation = {"id": uuid.uuid4().hex, "action": action,
                    "payload": row.desired_payload if action == "update" else row.payload,
                    "etag": item["etag"], "state": "pending"}
                # The next iteration executes only after this intent is durably committed.
        row.retry_at = now() if row.sync_pending else None
        db.commit()
    except (google.CalendarConfigurationError, google.CalendarProviderError, google_events.GoogleEventsError, transport.ExportError) as error:
        code = getattr(error, "code", "uncertain" if isinstance(error, google_events.GoogleEventsError) and error.status >= 500 else "credentials_unavailable")
        if code == "conflict" and changes.pending(row):
            row.mutation = {**row.mutation, "state": "conflict"}
            row.revision += 1
        failure(row, code)
        db.commit()


def run_batch(engine, limit=10):
    """One bounded pass. Owner locks serialize workers, CRUD and reconnects."""
    with Session(engine) as db:
        identities = list(db.scalars(select(GoogleExport.id).where(GoogleExport.sync_pending.is_(True),
            or_(GoogleExport.retry_at.is_(None), GoogleExport.retry_at <= now()))
            .order_by(GoogleExport.desired_payload.is_not(None), GoogleExport.retry_at, GoogleExport.created_at)
            .limit(limit)))
    for identity in identities:
        with Session(engine, expire_on_commit=False, autoflush=False) as db:
            try:
                process_row(db, identity)
            except Exception as error:  # noqa: BLE001 - The session rolls back; the prior durable intent remains retryable.
                # A transaction failure keeps the previously committed intent for a later pass.
                # Never log provider responses, credentials or user text.
                logger.warning("Google sync deferred: %s", type(error).__name__)
