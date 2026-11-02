"""Conditional changes to an owned exported copy, with recoverable write outcomes."""
from fastapi import HTTPException
from sqlalchemy import or_, select

from app.models import GoogleCalendarConnection, GoogleExport, User
from app.services import google_export as transport


def pending(row):
    return bool(row.mutation and row.mutation.get("state") == "pending")


def prevent_local_delete(db, user_id, kind, item_id):
    # Same owner-before-export/item order as Google writes. No external requests.
    db.scalar(select(User.id).where(User.id == user_id).with_for_update())
    connection = db.scalar(select(GoogleCalendarConnection).where(GoogleCalendarConnection.user_id == user_id))
    if connection is None:
        return  # Unconnected/old-account copies must be managed directly in Google.
    scope = (GoogleExport.kind == kind) & (GoogleExport.item_id == item_id)
    if kind == "task":
        scope = or_(scope, GoogleExport.task_id == item_id)
    row = db.scalar(select(GoogleExport.id).where(
        GoogleExport.user_id == user_id, GoogleExport.deleted_at.is_(None), scope,
        GoogleExport.connection_binding == transport.binding(connection),
    ).limit(1))
    if row:
        raise HTTPException(409, "Google 전송 상태를 먼저 확인하고 상세 화면에서 Google 삭제를 완료해 주세요.")


def personal(item):
    # Never issue meeting notifications or modify a recurring/imported event.
    organizer = item.get("organizer") or {}
    if not isinstance(organizer, dict):
        return False
    return not (item.get("attendees") or item.get("recurrence") or item.get("recurringEventId")) and (
        item.get("eventType", "default") == "default"
        and organizer.get("self", True) is True
    )


def properties(item):
    extension = item.get("extendedProperties")
    private = extension.get("private") if isinstance(extension, dict) else None
    return private if isinstance(private, dict) else {}


def read_copy(token, row):
    status, item = transport.request(token, "GET", row.google_event_id)
    if status in {404, 410} or item.get("status") == "cancelled":
        return None
    if not personal(item) or not transport.matches(item, row.google_event_id, row.id, row.payload):
        raise transport.ExportError(409, "conflict")
    etag = item.get("etag")
    if not isinstance(etag, str) or not 1 <= len(etag) <= 512 or any(c in etag for c in "\r\n"):
        raise transport.ExportError(409, "conflict")
    return item


def change_once(token, row, intent):
    status, item = transport.request(token, "GET", row.google_event_id)
    missing = status in {404, 410} or item.get("status") == "cancelled"
    if missing:
        if intent["action"] == "delete":
            return True
        raise transport.ExportError(409, "conflict")
    if not personal(item):
        raise transport.ExportError(409, "conflict")
    if intent["action"] == "update" and (
        properties(item).get("plancatchChange") == intent["id"]
        and transport.matches(item, row.google_event_id, row.id, intent["payload"])
    ):
        return True  # The previous PATCH succeeded but its response/commit was lost.
    if not transport.matches(item, row.google_event_id, row.id, row.payload) or item.get("etag") != intent["etag"]:
        raise transport.ExportError(409, "conflict")
    if intent["action"] == "delete":
        transport.request(token, "DELETE", row.google_event_id, etag=intent["etag"])
    else:
        body = {**intent["payload"], "extendedProperties": {"private": {
            **properties(item), "plancatchChange": intent["id"],
        }}}
        _, updated = transport.request(token, "PATCH", row.google_event_id, body, etag=intent["etag"])
        if (not transport.matches(updated, row.google_event_id, row.id, intent["payload"])
                or properties(updated).get("plancatchChange") != intent["id"]):
            raise transport.ExportError(409, "conflict")
    return False
