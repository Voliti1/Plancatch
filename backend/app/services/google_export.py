"""Fixed Google endpoints, stable client IDs and no automatic write retries."""

import json
import re
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from app.services import google_calendar as google
from app.services.google_events import EVENTS_URL


class ExportError(Exception):
    def __init__(self, status=502, code="uncertain"):
        self.status, self.code = status, code
        super().__init__(
            "전송 결과를 확인하지 못했습니다. 같은 항목의 미리보기를 다시 열어 재시도하세요. 새 일정은 만들지 마세요."
        )


def request(token, method, event_id, body=None):
    if method not in {"GET", "POST"} or not re.fullmatch(r"[0-9a-v]{5,64}", event_id):
        raise ExportError()
    fields = "fields=id,summary,status,start,end,extendedProperties(private)"
    url = (
        EVENTS_URL + "/" + event_id + "?" + fields
        if method == "GET"
        else EVENTS_URL + "?sendUpdates=none&" + fields
    )
    req = Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body else None,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    try:
        try:
            with build_opener(google.NoRedirect()).open(req, timeout=10) as response:
                status, raw = response.status, response.read(65537)
        except HTTPError as error:
            status, raw = error.code, error.read(65537)
        if len(raw) > 65536:
            raise ExportError()
        if method == "GET" and status in {404, 410}:
            return status, {}
        if method == "POST" and status == 409:
            return status, {}
        if status in {429, 503}:
            raise ExportError(503, "rate_limited")
        if status in {401, 403}:
            raise ExportError(409, "access_denied")
        if status not in {200, 201}:
            raise ExportError()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ExportError()
        return status, payload
    except (URLError, OSError, ValueError, TypeError, UnicodeError):
        raise ExportError() from None


def matches(item, event_id, export_id, payload):
    try:
        return (
            item["id"] == event_id
            and item.get("status") == "confirmed"
            and item["extendedProperties"]["private"]["plancatchExport"]
            == str(export_id)
            and item["summary"] == payload["summary"]
            and all(
                datetime.fromisoformat(item[key]["dateTime"].replace("Z", "+00:00"))
                == datetime.fromisoformat(payload[key]["dateTime"])
                for key in ("start", "end")
            )
        )
    except (KeyError, ValueError, TypeError, AttributeError):
        return False


def send_once(token, row):
    status, item = request(token, "GET", row.google_event_id)
    if status == 410 or item.get("status") == "cancelled":
        raise ExportError(409, "conflict")
    if status == 404:
        body = {
            **row.payload,
            "id": row.google_event_id,
            "extendedProperties": {"private": {"plancatchExport": str(row.id)}},
            "reminders": {"useDefault": False},
        }
        status, item = request(token, "POST", row.google_event_id, body)
        if status == 409:
            status, item = request(token, "GET", row.google_event_id)
            if status == 404:
                raise ExportError()  # Provider visibility may lag; retain this same ID for retry.
    if status not in {200, 201} or not matches(
        item, row.google_event_id, row.id, row.payload
    ):
        raise ExportError(409, "conflict")
    return item


def binding(connection):
    value = connection.connected_at
    value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return google.digest(value.isoformat())
