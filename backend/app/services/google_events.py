"""Read-only, bounded primary-calendar client. No event writes or token cache."""

import json
from datetime import UTC, date, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.schemas.google_event import GoogleEventsPage, GoogleEventView
from app.services import google_calendar as google

EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
MAX_BYTES = 1024 * 1024


class GoogleEventsError(Exception):
    """Only fixed public messages/statuses; never include provider content."""

    def __init__(
        self,
        status=502,
        message="구글 일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    ):
        super().__init__(message)
        self.status = status


def refresh_access(config, refresh):
    try:
        status, payload = google._post(
            google.TOKEN_URL,
            {
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
        )
    except google.CalendarProviderError:
        raise GoogleEventsError() from None
    if status == 400 and payload.get("error") == "invalid_grant":
        raise GoogleEventsError(
            409,
            "구글 인증이 만료되었거나 취소되었습니다. 구글 계정을 다시 연결해 주세요.",
        )
    if status in (429, 503):
        raise GoogleEventsError(
            503, "구글 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요."
        )
    token = payload.get("access_token")
    scope = payload.get("scope")
    if scope is not None and (
        not isinstance(scope, str) or google.SCOPE not in scope.split()
    ):
        raise GoogleEventsError(
            409, "구글 캘린더 권한을 확인하고 계정을 다시 연결해 주세요."
        )
    if (
        status != 200
        or not isinstance(token, str)
        or not token
        or len(token) > 16384
        or str(payload.get("token_type", "")).lower() != "bearer"
    ):
        raise GoogleEventsError()
    rotated = payload.get("refresh_token")
    if rotated is not None and (
        not isinstance(rotated, str) or not rotated or len(rotated) > 16384
    ):
        raise GoogleEventsError()
    return token, rotated


def _fetch(token, start, end):
    query = urlencode(
        {
            "timeMin": start.isoformat(),
            "timeMax": end.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 250,
            "timeZone": "Asia/Seoul",
            "showDeleted": "false",
            "fields": "nextPageToken,items(id,summary,status,start,end)",
        }
    )
    request = Request(
        EVENTS_URL + "?" + query,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
    )
    try:
        try:
            with build_opener(google.NoRedirect()).open(
                request, timeout=10
            ) as response:
                status, raw = response.status, response.read(MAX_BYTES + 1)
        except HTTPError as error:
            status, raw = error.code, error.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise GoogleEventsError()
        if status == 403:
            try:
                reasons = {
                    item.get("reason")
                    for item in json.loads(raw)["error"]["errors"]
                    if isinstance(item, dict)
                }
            except (ValueError, TypeError, KeyError, UnicodeError):
                reasons = set()
            if reasons & {
                "rateLimitExceeded",
                "userRateLimitExceeded",
                "quotaExceeded",
            }:
                raise GoogleEventsError(
                    503,
                    "구글 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.",
                )
        if status in (401, 403, 404):
            raise GoogleEventsError(
                409,
                "구글 캘린더에 접근할 수 없습니다. 권한을 확인하고 계정을 다시 연결해 주세요.",
            )
        if status in (429, 503):
            raise GoogleEventsError(
                503,
                "구글 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.",
            )
        if status != 200:
            raise GoogleEventsError()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise GoogleEventsError()
        return payload
    except (URLError, OSError, ValueError, TypeError, UnicodeError):
        raise GoogleEventsError() from None


def _time(value):
    parsed = datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(value["timeZone"]))
    return parsed.astimezone(UTC)


def list_primary(token, start, end) -> GoogleEventsPage:
    payload = _fetch(token, start, end)
    items = payload.get("items", [])
    if not isinstance(items, list) or len(items) > 250:
        raise GoogleEventsError()
    events, skipped = [], 0
    for item in items:
        if isinstance(item, dict) and item.get("status") == "cancelled":
            continue
        try:
            event_id = item["id"]
            title = item.get("summary", "(제목 없음)")
            if (
                not isinstance(event_id, str)
                or not 1 <= len(event_id) <= 1024
                or not isinstance(title, str)
            ):
                raise ValueError
            values = {"id": event_id, "title": title[:500] or "(제목 없음)"}
            first, last = item["start"], item["end"]
            if "date" in first and "date" in last:
                begin, finish = (
                    date.fromisoformat(first["date"]),
                    date.fromisoformat(last["date"]),
                )
                if finish <= begin:
                    raise ValueError
                values.update(start_date=begin, end_date=finish)
            else:
                begin, finish = _time(first), _time(last)
                if finish <= begin:
                    raise ValueError
                values.update(start_at=begin, end_at=finish)
            events.append(GoogleEventView(**values))
        except (KeyError, TypeError, ValueError, AttributeError, ZoneInfoNotFoundError):
            skipped += 1
    return GoogleEventsPage(
        events=events,
        has_more=bool(payload.get("nextPageToken")),
        skipped_count=skipped,
    )
