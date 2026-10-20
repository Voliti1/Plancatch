"""All Google HTTP responses are synthetic; no personal calendars are accessed."""

import io
import json
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError

import pytest

from app.models.google_calendar import GoogleCalendarConnection
from app.services import google_calendar as google
from app.services import google_events as events
from tests.test_auth import TestingSession
from tests.test_google_calendar import owner, start
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_sources import (
    configure_test_jwt as configure_test_jwt,  # noqa: PLC0414
)

BASE = "/api/integrations/google-calendar/events"
QUERY = {
    "start_from": "2026-10-01T00:00:00+09:00",
    "end_before": "2026-11-01T00:00:00+09:00",
}


def connected(setup):
    auth = owner()
    _, state, _ = start(setup, auth)
    response = setup.client.get(
        google.CALLBACK_PATH, params={"state": state, "code": "read-test"}
    )
    assert response.status_code == 200  # fixed completion after redirect
    return auth


def token_response(monkeypatch, payload=None, status=200):
    monkeypatch.setattr(
        google,
        "_post",
        lambda *_: (
            status,
            payload or {"access_token": "fake-access", "token_type": "Bearer"},
        ),
    )


def test_auth_ownership_and_range_fail_before_provider(setup, monkeypatch):
    calls = []
    monkeypatch.setattr(events, "refresh_access", lambda *_: calls.append(True))
    assert setup.client.get(BASE, params=QUERY).status_code == 401
    auth = owner()
    assert setup.client.get(BASE, params=QUERY, headers=auth).status_code == 409
    assert (
        setup.client.get(
            BASE, params={**QUERY, "end_before": "2027-01-01T00:00:00Z"}, headers=auth
        ).status_code
        == 422
    )
    assert (
        setup.client.get(
            BASE, params={**QUERY, "start_from": "2026-10-01"}, headers=auth
        ).status_code
        == 422
    )
    assert calls == []


def test_primary_list_timed_all_day_and_minimal_private_fields(setup, monkeypatch):
    auth = connected(setup)
    token_response(monkeypatch)
    monkeypatch.setattr(
        events,
        "_fetch",
        lambda *_: {
            "nextPageToken": "private-page-token",
            "items": [
                {
                    "id": "timed",
                    "summary": "면접",
                    "description": "private",
                    "attendees": ["hidden"],
                    "start": {"dateTime": "2026-10-21T09:00:00+09:00"},
                    "end": {"dateTime": "2026-10-21T10:00:00+09:00"},
                },
                {
                    "id": "allday",
                    "summary": "휴가",
                    "start": {"date": "2026-10-22"},
                    "end": {"date": "2026-10-24"},
                },
                {"id": "bad", "start": {}, "end": {}},
                {"id": "gone", "status": "cancelled"},
            ],
        },
    )
    response = setup.client.get(BASE, params=QUERY, headers=auth)
    assert response.status_code == 200
    data = response.json()
    assert data["has_more"] and data["skipped_count"] == 1
    assert [r["id"] for r in data["events"]] == ["timed", "allday"]
    assert data["events"][0]["start_at"] == "2026-10-21T00:00:00Z"
    assert data["events"][1]["end_date"] == "2026-10-24"
    assert (
        "private" not in response.text
        and "hidden" not in response.text
        and "fake-access" not in response.text
    )
    assert response.headers["cache-control"] == "no-store"
    other = owner()
    assert setup.client.get(BASE, params=QUERY, headers=other).status_code == 409


def test_rotated_refresh_saved_even_when_calendar_read_fails(setup, monkeypatch):
    auth = connected(setup)
    token_response(
        monkeypatch,
        {
            "access_token": "fake-access",
            "token_type": "Bearer",
            "refresh_token": "fake-rotated",
        },
    )

    def fail(*_):
        raise events.GoogleEventsError()

    monkeypatch.setattr(events, "list_primary", fail)
    assert setup.client.get(BASE, params=QUERY, headers=auth).status_code == 502
    with TestingSession() as db:
        # Find the current synthetic user's connection without printing its contents.
        user_id = setup.client.get("/api/auth/me", headers=auth).json()["id"]
        import uuid

        row = db.get(GoogleCalendarConnection, uuid.UUID(user_id))
        assert (
            google.decrypt(
                google.configuration(),
                row.user_id,
                "refresh",
                row.refresh_token_ciphertext,
            )
            == "fake-rotated"
        )


@pytest.mark.parametrize(
    "status,payload,expected",
    [
        (400, {"error": "invalid_grant", "error_description": "NEVER-ECHO"}, 409),
        (429, {}, 503),
        (200, {"access_token": "x", "token_type": "Bearer", "scope": "wrong"}, 409),
        (200, {"access_token": "x", "token_type": "wrong"}, 502),
    ],
)
def test_provider_failures_are_sanitized(setup, monkeypatch, status, payload, expected):
    auth = connected(setup)
    monkeypatch.setattr(google, "_post", lambda *_: (status, payload))
    response = setup.client.get(BASE, params=QUERY, headers=auth)
    assert response.status_code == expected and "NEVER-ECHO" not in response.text


@pytest.mark.parametrize(
    "mode", ["redirect", "oversize", "invalid-json", "offline", "forbidden"]
)
def test_http_transport_is_bounded_and_fixed(monkeypatch, mode):
    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, n):
            return (
                b"x" * n
                if mode == "oversize"
                else (b"not-json" if mode == "invalid-json" else b'{"items":[]}')
            )

    class Opener:
        def open(self, request, timeout):
            assert request.full_url.startswith(events.EVENTS_URL + "?")
            assert request.get_method() == "GET" and timeout == 10
            assert request.get_header("Authorization") == "Bearer fake"
            if mode in {"redirect", "forbidden"}:
                import io

                raise HTTPError(
                    request.full_url,
                    302 if mode == "redirect" else 403,
                    "hidden",
                    {},
                    io.BytesIO(b"NEVER-ECHO"),
                )
            if mode == "offline":
                raise URLError("NEVER-ECHO")
            return Response()

    def opener(handler):
        assert isinstance(handler, google.NoRedirect)
        return Opener()

    monkeypatch.setattr(events, "build_opener", opener)
    with pytest.raises(events.GoogleEventsError) as error:
        events._fetch(
            "fake", datetime(2026, 10, 1, tzinfo=UTC), datetime(2026, 11, 1, tzinfo=UTC)
        )
    assert "NEVER-ECHO" not in str(error.value)


def test_timezone_without_offset_and_exclusive_all_day(monkeypatch):
    monkeypatch.setattr(
        events,
        "_fetch",
        lambda *_: {
            "items": [
                {
                    "id": "zoned",
                    "start": {
                        "dateTime": "2026-10-01T09:00:00",
                        "timeZone": "Asia/Seoul",
                    },
                    "end": {
                        "dateTime": "2026-10-01T10:00:00",
                        "timeZone": "Asia/Seoul",
                    },
                },
                {
                    "id": "wrong",
                    "start": {"date": "2026-10-01"},
                    "end": {"date": "2026-10-01"},
                },
            ]
        },
    )
    result = events.list_primary("fake", None, None)
    assert len(result.events) == 1 and result.skipped_count == 1
    assert result.events[0].start_at == datetime(2026, 10, 1, tzinfo=UTC)


@pytest.mark.parametrize(
    "reason", ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]
)
def test_403_quota_is_not_misreported_as_permission_failure(monkeypatch, reason):
    class Opener:
        def open(self, request, timeout):
            raw = json.dumps(
                {"error": {"errors": [{"reason": reason}], "message": "NEVER-ECHO"}}
            ).encode()
            raise HTTPError(request.full_url, 403, "hidden", {}, io.BytesIO(raw))

    monkeypatch.setattr(events, "build_opener", lambda *_: Opener())
    with pytest.raises(events.GoogleEventsError) as error:
        events._fetch(
            "fake", datetime(2026, 10, 1, tzinfo=UTC), datetime(2026, 11, 1, tzinfo=UTC)
        )
    assert error.value.status == 503 and "NEVER-ECHO" not in str(error.value)
