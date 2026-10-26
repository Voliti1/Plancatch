"""Explicit snapshot export only; never updates/deletes a Google event."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.google_calendar import SAFE_HEADERS, _config, _lock_user, _utc
from app.models import (
    Deadline,
    GoogleCalendarConnection,
    GoogleExport,
    ScheduledEvent,
    Task,
)
from app.schemas.google_export import (
    ExportConfirmation,
    ExportPreview,
    ExportResult,
    ExportTarget,
)
from app.services import google_calendar as google
from app.services import google_events
from app.services import google_export as transport

router = APIRouter(prefix=google.PREFIX + "/exports", tags=["google-calendar"])


def connected(db, user_id):
    _lock_user(db, user_id)
    row = db.scalar(
        select(GoogleCalendarConnection)
        .where(GoogleCalendarConnection.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    if (
        row is None
        or google.SCOPE not in row.scopes.split()
        or (
            row.refresh_expires_at and _utc(row.refresh_expires_at) <= datetime.now(UTC)
        )
    ):
        raise HTTPException(409, "구글 계정을 먼저 연결하거나 다시 연결해 주세요.")
    return row


def stored(db, user_id, target):
    return db.scalar(
        select(GoogleExport)
        .where(
            GoogleExport.user_id == user_id,
            GoogleExport.kind == target.kind,
            GoogleExport.item_id == target.item_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def payload_for(db, user_id, target):
    model = {"deadline": Deadline, "task": Task, "event": ScheduledEvent}[target.kind]
    item = db.scalar(
        select(model)
        .where(model.id == target.item_id, model.user_id == user_id)
        .with_for_update()
    )
    if item is None:
        raise HTTPException(404, "전송할 항목을 찾을 수 없습니다.")
    task_id = None
    if target.kind == "deadline":
        if not item.is_confirmed:
            raise HTTPException(422, "확인한 마감일만 전송할 수 있습니다.")
        title, start = item.title, _utc(item.due_at)
        try:
            end = start + timedelta(minutes=1)
        except OverflowError:
            raise HTTPException(422, "전송할 수 없는 마감 시각입니다.") from None
    elif target.kind == "task":
        if (
            item.schedule_type != "fixed"
            or not item.earliest_start
            or not item.latest_end
        ):
            raise HTTPException(
                422,
                "고정 할 일의 시작·종료 일시를 입력하거나 아래 배치 시간을 확정해 주세요.",
            )
        if db.scalar(
            select(ScheduledEvent.id)
            .where(ScheduledEvent.task_id == item.id, ScheduledEvent.user_id == user_id)
            .limit(1)
        ):
            raise HTTPException(
                409, "배치가 있는 할 일은 아래의 확정 배치에서 전송해 주세요."
            )
        title, start, end, task_id = (
            item.title,
            _utc(item.earliest_start),
            _utc(item.latest_end),
            item.id,
        )
    else:
        task = db.scalar(
            select(Task).where(Task.id == item.task_id, Task.user_id == user_id)
        )
        if task is None:
            raise HTTPException(404, "연결된 할 일을 찾을 수 없습니다.")
        if (
            item.status != "approved"
            or not item.is_user_approved
            or item.google_event_id
        ):
            raise HTTPException(
                422, "Google에 아직 보내지 않은 확정 배치만 전송할 수 있습니다."
            )
        title, start, end, task_id = (
            task.title,
            _utc(item.start_at),
            _utc(item.end_at),
            task.id,
        )
    start = start.replace(microsecond=start.microsecond // 1000 * 1000)
    end = end.replace(microsecond=end.microsecond // 1000 * 1000)
    if end <= start:
        raise HTTPException(422, "종료 시각은 시작보다 늦어야 합니다.")
    return {
        "summary": title,
        "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Seoul"},
        "end": {"dateTime": end.isoformat(), "timeZone": "Asia/Seoul"},
    }, task_id


def digest(payload):
    return google.digest(json.dumps(payload, sort_keys=True, ensure_ascii=False))


def prevent_family_duplicate(db, user_id, target, task_id):
    if task_id is None:
        return
    other_kind = "event" if target.kind == "task" else "task"
    if db.scalar(
        select(GoogleExport.id)
        .where(
            GoogleExport.user_id == user_id,
            GoogleExport.task_id == task_id,
            GoogleExport.kind == other_kind,
        )
        .limit(1)
    ):
        raise HTTPException(
            409,
            "이 할 일은 다른 등록 방식으로 전송한 이력이 있어 중복 전송을 막았습니다.",
        )


@router.post("/preview", response_model=ExportPreview)
def preview(
    target: ExportTarget,
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
):
    response.headers.update(SAFE_HEADERS)
    config = _config()
    connection = connected(db, current_user.id)
    current, task_id = payload_for(db, current_user.id, target)
    row = stored(db, current_user.id, target)
    if row is None:
        prevent_family_duplicate(db, current_user.id, target, task_id)
    payload = row.payload if row else current
    status = row.status if row else "new"
    changed = digest(current) != digest(payload)
    if row and row.connection_binding != transport.binding(connection):
        status = "blocked"
    token = None
    if status in {"new", "pending"}:
        claims = {
            "kind": target.kind,
            "item_id": str(target.item_id),
            "hash": digest(payload),
            "connection": transport.binding(connection),
            "expires": int(time.time()) + 600,
        }
        token = google.encrypt(
            config, current_user.id, "export-preview", json.dumps(claims)
        )
    note = "현재 연결된 Google 기본 캘린더에 제목·시간만 보냅니다. 메모·원문·참석자·알림은 보내지 않습니다."
    if target.kind == "deadline":
        note += " 마감 시각부터 1분 길이의 표시로 등록합니다."
    if changed:
        note += " 로컬 내용이 변경되었습니다. 아래는 이전에 전송을 확인한 내용이며 변경 사항은 보내지 않습니다."
    if status == "blocked":
        note += " 연결이 바뀌어 기존 항목을 재전송하지 않습니다. Google 캘린더에서 이전 전송을 확인해 주세요."
    if status == "conflict":
        note += " Google에서 삭제·수정됐거나 결과가 일치하지 않아 덮어쓰거나 새로 만들지 않습니다."
    return ExportPreview(
        title=payload["summary"],
        start_at=payload["start"]["dateTime"],
        end_at=payload["end"]["dateTime"],
        status=status,
        changed=changed,
        preview_token=token,
        note=note,
    )


@router.post("/confirm", response_model=ExportResult)
def confirm(
    target: ExportConfirmation,
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
):
    response.headers.update(SAFE_HEADERS)
    config = _config()
    connection = connected(db, current_user.id)
    try:
        claims = json.loads(
            google.decrypt(
                config, current_user.id, "export-preview", target.preview_token
            )
        )
        valid = (
            claims["kind"] == target.kind
            and claims["item_id"] == str(target.item_id)
            and type(claims["expires"]) is int
            and int(time.time()) < claims["expires"]
            and claims["connection"] == transport.binding(connection)
        )
    except (google.CalendarProviderError, ValueError, TypeError, KeyError):
        valid = False
    if not valid:
        raise HTTPException(
            409, "미리보기가 만료됐거나 연결이 변경되었습니다. 다시 확인해 주세요."
        )
    payload, task_id = payload_for(db, current_user.id, target)
    row = stored(db, current_user.id, target)
    if row is None:
        prevent_family_duplicate(db, current_user.id, target, task_id)
        if digest(payload) != claims["hash"]:
            raise HTTPException(
                409, "내용이 바뀌었습니다. 새 미리보기를 확인해 주세요."
            )
        identity = uuid.uuid4()
        row = GoogleExport(
            id=identity,
            user_id=current_user.id,
            kind=target.kind,
            item_id=target.item_id,
            task_id=task_id,
            connection_binding=transport.binding(connection),
            payload=payload,
            payload_hash=digest(payload),
            google_event_id="pc" + identity.hex,
        )
        db.add(row)
        db.commit()  # Durable ID before the first Google request, even if its response is lost.
        connection = connected(db, current_user.id)
        row = stored(db, current_user.id, target)
    if (
        row.connection_binding != transport.binding(connection)
        or row.payload_hash != claims["hash"]
    ):
        raise HTTPException(
            409, "이전 전송 내용 또는 연결과 다릅니다. 중복 전송하지 않습니다."
        )
    if row.status == "sent":
        return ExportResult(
            status="sent", google_event_id=row.google_event_id, already_sent=True
        )
    if row.status == "conflict":
        raise HTTPException(
            409, "Google에서 변경된 항목은 새로 만들거나 덮어쓰지 않습니다."
        )
    try:
        refresh = google.decrypt(
            config, current_user.id, "refresh", connection.refresh_token_ciphertext
        )
        token, rotated = google_events.refresh_access(config, refresh)
        if rotated:
            connection.refresh_token_ciphertext = google.encrypt(
                config, current_user.id, "refresh", rotated
            )
        # Hold the user lock across bounded outbound calls; reconnect/disconnect waits.
        transport.send_once(token, row)
        row.status, row.sent_at, row.error_code = "sent", datetime.now(UTC), None
        db.commit()
    except (
        google.CalendarProviderError,
        google_events.GoogleEventsError,
        transport.ExportError,
    ) as error:
        code = getattr(error, "code", "credentials_unavailable")
        row.error_code = code
        if code == "conflict":
            row.status = "conflict"
        db.commit()  # Keep rotated credentials and the immutable intent on errors.
        message = (
            str(error)
            if not isinstance(error, google.CalendarProviderError)
            else "구글 계정을 다시 연결하고 전송 상태를 확인해 주세요."
        )
        raise HTTPException(getattr(error, "status", 409), message) from None
    return ExportResult(
        status="sent", google_event_id=row.google_event_id, already_sent=False
    )
