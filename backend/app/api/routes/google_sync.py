"""Owned automatic synchronization status and an explicit recovery action."""
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import and_, exists, or_, select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.google_calendar import SAFE_HEADERS
from app.models import (
    Deadline,
    GoogleCalendarConnection,
    GoogleExport,
    ScheduledEvent,
    Task,
)
from app.schemas.google_export import ExportTarget
from app.services import google_calendar as google
from app.services import google_export as transport
from app.services import google_sync as sync

router = APIRouter(prefix=google.PREFIX + "/auto-sync", tags=["google-calendar"])
MESSAGES = {
    "conflict": "Google에서 직접 바뀌었거나 삭제된 일정입니다. Google의 내용을 확인해 주세요.",
    "connection_changed": "Google 연결이 바뀌었습니다. 이전 계정의 일정은 Google에서 직접 확인해 주세요.",
    "access_denied": "Google 캘린더 권한을 확인하고 계정을 다시 연결해 주세요.",
    "credentials_unavailable": "Google 계정을 다시 연결해 주세요.",
    "rate_limited": "Google 요청이 잠시 제한되었습니다. 저장한 일정은 유지하며 자동으로 다시 시도합니다.",
    "uncertain": "Google 반영 결과를 다시 확인하고 있습니다. 같은 일정이 중복 생성되지 않도록 처리합니다.",
}


def owned(db, user_id, kind, item_id):
    row = db.scalar(select(GoogleExport).where(GoogleExport.user_id == user_id,
        GoogleExport.kind == kind, GoogleExport.item_id == item_id))
    model = {"deadline": Deadline, "task": Task, "event": ScheduledEvent}[kind]
    local = db.scalar(select(model).where(model.id == item_id, model.user_id == user_id))
    if local is None and row is None:
        raise HTTPException(404, "일정을 찾을 수 없습니다.")
    return local, row


def delivery_state(row, connection):
    if connection is None:
        return {"state": "not_connected", "note": "Google 계정을 연결하면 이후 등록·수정·삭제가 자동 반영됩니다.", "retryable": False}
    if row and row.connection_binding != transport.binding(connection):
        return {"state": "failed", "note": MESSAGES["connection_changed"], "retryable": False}
    if row and row.sync_pending:
        return {"state": "retrying" if row.error_code else "pending",
            "note": MESSAGES.get(row.error_code, "저장한 변경 내용을 Google 캘린더에 반영하고 있습니다."), "retryable": False}
    if row and row.error_code:
        return {"state": "failed", "note": MESSAGES.get(row.error_code, "Google 반영을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."), "retryable": True}
    if row and row.deleted_at:
        return {"state": "deleted", "note": "Google 캘린더에서도 삭제되었습니다.", "retryable": False}


@router.get("/deletions")
def list_deletions(current_user: CurrentUser, db: DatabaseSession, response: Response,
                   limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)):
    response.headers.update(SAFE_HEADERS)
    missing = or_(*[
        and_(GoogleExport.kind == kind, ~exists().where(
            model.id == GoogleExport.item_id, model.user_id == current_user.id))
        for kind, model in (("deadline", Deadline), ("task", Task), ("event", ScheduledEvent))
    ])
    completed = and_(GoogleExport.deleted_at.is_not(None),
                     GoogleExport.sync_pending.is_(False), GoogleExport.error_code.is_(None))
    rows = list(db.scalars(select(GoogleExport).where(
        GoogleExport.user_id == current_user.id, missing,
        or_(~completed, GoogleExport.deleted_at >= sync.now() - timedelta(hours=24)),
    ).order_by(completed,
               GoogleExport.deleted_at.desc(), GoogleExport.created_at.desc(), GoogleExport.id)
      .offset(offset).limit(limit + 1)))
    connection = db.get(GoogleCalendarConnection, current_user.id)
    entries = []
    for row in rows[:limit]:
        if row.deleted_at and not row.sync_pending and not row.error_code:
            state = {"state": "deleted", "note": "Google 캘린더에서도 삭제되었습니다.", "retryable": False}
        else:
            state = delivery_state(row, connection) or {
                "state": "ready", "note": "Google 캘린더 삭제를 다시 요청해 주세요.", "retryable": True}
            if state["state"] == "pending":
                state = {**state, "note": "Google 캘린더에서 삭제하고 있습니다."}
        entries.append({"kind": row.kind, "item_id": row.item_id,
                        "title": row.payload["summary"], **state})
    return {"entries": entries, "has_more": len(rows) > limit}


@router.get("")
def status(current_user: CurrentUser, db: DatabaseSession, response: Response,
           kind: Literal["deadline", "task", "event"], item_id: uuid.UUID):
    response.headers.update(SAFE_HEADERS)
    local, row = owned(db, current_user.id, kind, item_id)
    connection = db.get(GoogleCalendarConnection, current_user.id)
    state = delivery_state(row, connection)
    if state is not None:
        return state
    if row and local is None:
        return {"state": "ready", "note": "플랜캐치에서 이미 삭제한 일정입니다. 지금 동기화하면 Google 사본도 삭제합니다.", "retryable": True}
    if row and row.status == "sent":
        return {"state": "synced", "note": "Google 캘린더에 반영되었습니다.", "retryable": False}
    eligible = local is not None
    if kind == "deadline" and local:
        eligible = local.is_confirmed
    elif kind == "task" and local:
        eligible = local.schedule_type == "fixed" and bool(local.earliest_start and local.latest_end) and not db.scalar(
            select(ScheduledEvent.id).where(ScheduledEvent.task_id == local.id, ScheduledEvent.user_id == current_user.id).limit(1))
    elif kind == "event" and local:
        eligible = local.status == "approved" and local.is_user_approved and not local.google_event_id
    return {"state": "ready" if eligible else "not_scheduled",
        "note": "이전 일정도 지금 Google에 반영할 수 있습니다." if eligible else "마감일을 확인하거나 할 일의 실제 시작·종료 시간을 지정하면 자동 반영됩니다.",
        "retryable": bool(eligible)}


@router.post("", status_code=202)
def retry(target: ExportTarget, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers.update(SAFE_HEADERS)
    sync.lock_owner(db, current_user.id)
    local, row = owned(db, current_user.id, target.kind, target.item_id)
    connection = db.get(GoogleCalendarConnection, current_user.id)
    if connection is None or (row and row.connection_binding != transport.binding(connection)):
        raise HTTPException(409, "현재 Google 연결을 먼저 확인해 주세요.")
    if target.kind == "deadline":
        sync.enqueue_deadline(db, current_user.id, target.item_id, force=True)
    elif target.kind == "task":
        sync.enqueue_task(db, current_user.id, target.item_id, force=True)
    elif local:
        sync.enqueue_task(db, current_user.id, local.task_id, force=True)
    else:
        sync.enqueue(db, current_user.id, target.kind, target.item_id, None, row.task_id, force=True)
    db.commit()
    return {"state": "pending", "note": "Google 캘린더 반영을 요청했습니다."}
