"""Explicit version-bound change previews and durable, retryable confirmations."""
import json
import re
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.google_calendar import SAFE_HEADERS, _config
from app.api.routes.google_exports import connected, digest, payload_for, stored
from app.schemas.google_export import (
    ChangeConfirmation,
    ChangePreview,
    ChangeResult,
    ChangeSnapshot,
    ChangeTarget,
)
from app.services import google_calendar as google
from app.services import google_changes as changes
from app.services import google_events
from app.services import google_export as transport

router = APIRouter(prefix=google.PREFIX + "/exports", tags=["google-calendar"])


def error_response(error):
    if isinstance(error, google_events.GoogleEventsError):
        return HTTPException(error.status, str(error))
    code = getattr(error, "code", "credentials_unavailable")
    message = {
        "conflict": "Google 일정이 변경되었거나 플랜캐치에서 보낸 내용과 다릅니다. 덮어쓰지 않았습니다. Google에서 직접 확인해 주세요.",
        "rate_limited": "Google 요청이 잠시 제한되었습니다. 같은 변경의 미리보기를 다시 확인해 주세요.",
        "access_denied": "Google 캘린더 연결 권한을 다시 확인해 주세요.",
        "credentials_unavailable": "Google 연결을 다시 확인해 주세요.",
    }.get(code, "변경 결과를 확인하지 못했습니다. 새 요청을 만들지 말고 같은 변경의 미리보기를 다시 확인해 주세요.")
    return HTTPException(getattr(error, "status", 409), message)


def access(config, connection, user_id):
    refresh = google.decrypt(config, user_id, "refresh", connection.refresh_token_ciphertext)
    token, rotated = google_events.refresh_access(config, refresh)
    if rotated:
        connection.refresh_token_ciphertext = google.encrypt(config, user_id, "refresh", rotated)
    return token


def manageable(db, user_id, target, connection):
    row = stored(db, user_id, target)
    if row is None or row.status == "pending":
        raise HTTPException(409, "먼저 같은 일정의 Google 전송 결과를 확인해 주세요.")
    if row.connection_binding != transport.binding(connection):
        raise HTTPException(409, "연결된 Google 계정이 변경되었습니다. 이전 계정의 일정은 직접 확인해 주세요.")
    return row


def snapshot(payload):
    return ChangeSnapshot(title=payload["summary"], start_at=payload["start"]["dateTime"], end_at=payload["end"]["dateTime"])


@router.post("/change-preview", response_model=ChangePreview)
def preview_change(target: ChangeTarget, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers.update(SAFE_HEADERS)
    config = _config()
    connection = connected(db, current_user.id)
    row = manageable(db, current_user.id, target, connection)
    before = snapshot(row.payload)
    if row.deleted_at:
        return ChangePreview(action=target.action, before=before, after=None, state="deleted", preview_token=None,
                             note="Google 일정은 삭제되었습니다. 플랜캐치 자료는 유지됩니다.")
    if changes.pending(row):
        intent = row.mutation
        if intent["action"] != target.action:
            raise HTTPException(409, "먼저 이전에 확인한 변경을 완료해 주세요.")
        state = "pending"
        note = "이전에 확인한 변경의 결과를 다시 확인합니다. 당시 확인한 내용으로만 재시도하며 새 일정은 만들지 않습니다."
    else:
        payload = payload_for(db, current_user.id, target)[0] if target.action == "update" else row.payload
        if target.action == "update" and digest(payload) == row.payload_hash:
            return ChangePreview(action=target.action, before=before, after=before, state="unchanged", preview_token=None,
                                 note="플랜캐치에 저장한 제목·시간과 마지막으로 보낸 내용이 같습니다.")
        try:
            token = access(config, connection, current_user.id)
            item = changes.read_copy(token, row)
        except (google.CalendarProviderError, google_events.GoogleEventsError, transport.ExportError) as error:
            db.commit()  # Persist a rotated refresh token, never an event change.
            raise error_response(error) from None
        if item is None and target.action == "update":
            db.commit()
            raise HTTPException(409, "Google에서 삭제된 일정은 다시 만들지 않습니다. 삭제 상태를 확인해 주세요.")
        intent = {"id": uuid.uuid4().hex, "action": target.action, "payload": payload,
                      "etag": item["etag"] if item else None, "state": "pending"}
        state = "ready"
        note = ("플랜캐치에 저장한 제목·시간만 Google에 반영합니다. Google에서 추가한 메모·알림은 유지합니다."
                if target.action == "update" else "이 Google 일정과 Google에서 추가한 메모·알림을 삭제합니다. 플랜캐치 자료는 유지됩니다.")
        if item is None:
            note = "Google에 일정이 없는 것을 확인했습니다. 확인 버튼을 누르면 삭제 상태를 기록합니다. 플랜캐치 자료는 유지됩니다."
    claims = {"kind": target.kind, "item_id": str(target.item_id), "action": target.action,
                  "operation_id": intent["id"], "revision": row.revision, "hash": digest(intent["payload"]),
                  "base_hash": row.payload_hash, "etag": intent["etag"], "connection": row.connection_binding,
                  "expires": int(time.time()) + 600}
    token = google.encrypt(config, current_user.id, "change-preview", json.dumps(claims))
    result = ChangePreview(action=target.action, before=before,
                           after=snapshot(intent["payload"]) if target.action == "update" else None,
                           state=state, preview_token=token, note=note)
    db.commit()  # Only credentials may have changed. No confirmed intent or calendar write yet.
    return result


@router.post("/change-confirm", response_model=ChangeResult)
def confirm_change(target: ChangeConfirmation, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers.update(SAFE_HEADERS)
    config = _config()
    connection = connected(db, current_user.id)
    row = manageable(db, current_user.id, target, connection)
    try:
        claims = json.loads(google.decrypt(config, current_user.id, "change-preview", target.preview_token))
        valid = (claims["kind"] == target.kind and claims["item_id"] == str(target.item_id)
                 and claims["action"] == target.action and claims["connection"] == row.connection_binding
                 and type(claims["expires"]) is int and int(time.time()) < claims["expires"]
                 and type(claims["revision"]) is int and re.fullmatch(r"[0-9a-f]{32}", claims["operation_id"]))
    except (google.CalendarProviderError, ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(409, "확인 내용이 만료됐거나 연결이 변경되었습니다. 미리보기를 다시 확인해 주세요.")
    old = row.mutation
    same = bool(old and old["id"] == claims["operation_id"] and old["action"] == target.action
                and digest(old["payload"]) == claims["hash"])
    if same and old["state"] == "applied":
        return ChangeResult(action=target.action, already_applied=True)
    if row.deleted_at or row.revision != claims["revision"] or row.payload_hash != claims["base_hash"]:
        raise HTTPException(409, "이미 변경된 결과입니다. 미리보기를 다시 확인해 주세요.")
    if changes.pending(row):
        if not same:
            raise HTTPException(409, "이전에 확인한 변경을 먼저 완료해 주세요.")
    else:
        payload = payload_for(db, current_user.id, target)[0] if target.action == "update" else row.payload
        if digest(payload) != claims["hash"]:
            raise HTTPException(409, "플랜캐치 내용이 바뀌었습니다. 새 미리보기를 확인해 주세요.")
        row.mutation = {"id": claims["operation_id"], "action": target.action, "payload": payload,
                            "etag": claims["etag"], "state": "pending"}
        db.commit()  # Persist the approved snapshot before any Google write.
        connection = connected(db, current_user.id)
        row = manageable(db, current_user.id, target, connection)
        if row.mutation["id"] != claims["operation_id"]:
            raise HTTPException(409, "다른 변경이 진행 중입니다. 상태를 다시 확인해 주세요.")
        if row.mutation["state"] == "applied":
            return ChangeResult(action=target.action, already_applied=True)
    try:
        token = access(config, connection, current_user.id)
        recovered = changes.change_once(token, row, row.mutation)
        if target.action == "update":
            row.payload = row.mutation["payload"]
            row.payload_hash = digest(row.payload)
        else:
            row.deleted_at = datetime.now(UTC)
            row.status = "sent"  # A terminal creation intent, including on an older-code rollback.
        row.mutation = {**row.mutation, "state": "applied", "applied_at": datetime.now(UTC).isoformat()}
        row.revision += 1
        row.error_code = None
        db.commit()
    except (google.CalendarProviderError, google_events.GoogleEventsError, transport.ExportError) as error:
        row.error_code = getattr(error, "code", "credentials_unavailable")
        if row.error_code == "conflict":
            row.mutation = {**row.mutation, "state": "conflict"}
            row.revision += 1
        db.commit()
        raise error_response(error) from None
    return ChangeResult(action=target.action, already_applied=recovered)
