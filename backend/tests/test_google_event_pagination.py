"""Bounded cursor reads use only fake calendars and fixed Google endpoints."""

import copy
import json
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import pytest

from app.models.google_calendar import GoogleCalendarConnection
from app.services import google_calendar as google
from app.services import google_events as events
from tests.test_auth import TestingSession
from tests.test_google_calendar import connection_user
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_google_events import BASE, QUERY, connected, token_response
from tests.test_google_schedule_conflicts import DRAFT, check
from tests.test_sources import client, configure_test_jwt  # noqa: F401

START = datetime(2026, 11, 1, tzinfo=UTC)
END = datetime(2026, 12, 1, tzinfo=UTC)


def item(identity, **extra):
    return {
        "id": identity,
        "summary": "검사 일정",
        "start": {"dateTime": DRAFT["start_at"]},
        "end": {"dateTime": DRAFT["end_at"]},
        **extra,
    }


def test_transport_follows_opaque_cursor_with_identical_filters_and_no_secret_fields(
    monkeypatch,
):
    requests = []
    cursor = "opaque+/=?&한글"

    class Response:
        status = 200

        def __init__(self, payload):
            self.raw = json.dumps(payload).encode()

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, limit):
            assert limit == events.MAX_BYTES + 1
            return self.raw

    class Opener:
        def open(self, request, timeout):
            requests.append(request)
            assert request.get_method() == "GET" and 0 < timeout <= 10
            assert request.get_header("Authorization") == "Bearer fake-only"
            query = parse_qs(urlsplit(request.full_url).query)
            if "pageToken" not in query:
                return Response(
                    {
                        "items": [item(str(i)) for i in range(250)],
                        "nextPageToken": cursor,
                    }
                )
            assert query["pageToken"] == [cursor]
            return Response(
                {
                    "items": [
                        item(
                            "last",
                            description="NEVER-ECHO",
                            attendees=[{"email": "NEVER-ECHO"}],
                        )
                    ]
                }
            )

    monkeypatch.setattr(events, "build_opener", lambda *_: Opener())
    page = events.list_primary("fake-only", START, END)
    assert len(page.events) == 251 and not page.has_more and not page.skipped_count
    first, second = [parse_qs(urlsplit(r.full_url).query) for r in requests]
    second.pop("pageToken")
    assert first == second
    assert all(urlsplit(r.full_url).netloc == "www.googleapis.com" for r in requests)
    assert not any(
        value in page.model_dump_json() for value in ("NEVER-ECHO", cursor, "fake-only")
    )


def test_short_and_empty_pages_still_follow_next_cursor(monkeypatch):
    calls = []

    def fetch(token, start, end, cursor=None, timeout=10):
        calls.append(cursor)
        return {
            None: {"items": [], "nextPageToken": "a"},
            "a": {"items": [item("first")], "nextPageToken": "b"},
            "b": {"items": [item("last")]},
        }[cursor]

    monkeypatch.setattr(events, "_fetch", fetch)
    page = events.list_primary("fake", START, END)
    assert (
        calls == [None, "a", "b"]
        and [e.id for e in page.events] == ["first", "last"]
        and not page.has_more
    )


@pytest.mark.parametrize("token", [False, True, 1, [], {}, "x" * 4097])
def test_invalid_cursor_stops_conservatively_and_is_not_exposed(monkeypatch, token):
    calls = []
    monkeypatch.setattr(
        events,
        "_fetch",
        lambda *_: (
            calls.append(True) or {"items": [item("kept")], "nextPageToken": token}
        ),
    )
    page = events.list_primary("fake", START, END)
    assert len(calls) == 1 and page.has_more and [e.id for e in page.events] == ["kept"]


def test_repeated_cursor_and_duplicate_events_never_claim_a_complete_scan(monkeypatch):
    calls = []
    monkeypatch.setattr(
        events,
        "_fetch",
        lambda *_: (
            calls.append(True)
            or {"items": [item("same")], "nextPageToken": "repeat-private"}
        ),
    )
    result = events.list_primary("fake", START, END)
    assert (
        len(calls) == 2
        and result.has_more
        and result.skipped_count == 1
        and len(result.events) == 1
    )
    assert "repeat-private" not in result.model_dump_json()
    pages = iter(
        [
            {"items": [item("same")], "nextPageToken": "next"},
            {"items": [item("same", summary="changed")]},
        ]
    )
    monkeypatch.setattr(events, "_fetch", lambda *_: next(pages))
    result = events.list_primary("fake", START, END)
    assert (
        not result.has_more
        and result.skipped_count == 1
        and result.events[0].title == "검사 일정"
    )


@pytest.mark.parametrize("mode", ["pages", "items", "time"])
def test_resource_limits_preserve_known_events_and_mark_scan_incomplete(
    monkeypatch, mode
):
    calls = []
    clock = [0.0]
    monkeypatch.setattr(events, "monotonic", lambda: clock[0])
    if mode == "pages":
        monkeypatch.setattr(events, "MAX_PAGES", 2)
    if mode == "items":
        monkeypatch.setattr(events, "MAX_ITEMS", 3)

    def fetch(*args):
        calls.append(args)
        if mode == "time":
            clock[0] = 13
        return {
            "items": [item(f"{len(calls)}-a"), item(f"{len(calls)}-b")],
            "nextPageToken": str(len(calls)),
        }

    monkeypatch.setattr(events, "_fetch", fetch)
    result = events.list_primary("fake", START, END)
    assert result.has_more
    assert len(result.events) == {"pages": 4, "items": 3, "time": 2}[mode]
    assert len(calls) == (1 if mode == "time" else 2)


@pytest.mark.parametrize(
    "failure", [events.GoogleEventsError(503), events.GoogleEventsError(502)]
)
def test_later_page_failure_preserves_earlier_results_and_refresh_rotation(
    setup, monkeypatch, failure
):
    auth = connected(setup)
    token_response(
        monkeypatch,
        {
            "access_token": "fake-access",
            "token_type": "Bearer",
            "refresh_token": "rotated-private",
        },
    )

    def fetch(token, start, end, cursor=None, timeout=10):
        if cursor:
            raise failure
        return {"items": [item("kept")], "nextPageToken": "private"}

    monkeypatch.setattr(events, "_fetch", fetch)
    response = client.get(BASE, params=QUERY, headers=auth)
    assert response.status_code == 200 and response.json()["has_more"]
    assert [e["id"] for e in response.json()["events"]] == ["kept"]
    assert "private" not in response.text
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, connection_user(auth))
        assert (
            google.decrypt(
                google.configuration(),
                row.user_id,
                "refresh",
                row.refresh_token_ciphertext,
            )
            == "rotated-private"
        )


def test_later_auth_loss_keeps_reconnect_error_instead_of_silently_using_partial(
    monkeypatch,
):
    def fetch(token, start, end, cursor=None, timeout=10):
        if cursor:
            raise events.GoogleEventsError(409, "다시 연결해 주세요.")
        return {"items": [item("earlier")], "nextPageToken": "private"}

    monkeypatch.setattr(events, "_fetch", fetch)
    with pytest.raises(events.GoogleEventsError) as error:
        events.list_primary("fake", START, END)
    assert error.value.status == 409


def test_busy_event_on_second_page_is_checked_before_saving(setup, monkeypatch):
    auth = connected(setup)
    monkeypatch.setattr(events, "refresh_access", lambda *_: ("fake", None))

    def fetch(token, start, end, cursor=None, timeout=10):
        if cursor:
            return {"items": [item("second-page-busy")]}
        return {
            "items": [item("first-page-free", transparency="transparent")],
            "nextPageToken": "next",
        }

    monkeypatch.setattr(events, "_fetch", fetch)
    result = check(auth).json()
    assert result["google_state"] == "checked"
    assert [e["id"] for e in result["conflicts"]] == ["second-page-busy"]


def test_auto_planner_avoids_second_page_busy_time_and_partial_still_blocks(
    setup, monkeypatch
):
    auth = connected(setup)
    monkeypatch.setattr(events, "refresh_access", lambda *_: ("fake", None))
    payload = item(
        "second-page-busy",
        start={"dateTime": "2026-11-16T09:00:00+09:00"},
        end={"dateTime": "2026-11-16T10:00:00+09:00"},
    )

    def fetch(token, start, end, cursor=None, timeout=10):
        return (
            {"items": [copy.deepcopy(payload)]}
            if cursor
            else {"items": [], "nextPageToken": "next"}
        )

    monkeypatch.setattr(events, "_fetch", fetch)
    task = client.post(
        "/api/tasks",
        headers=auth,
        json={
            "title": "계획 검사",
            "schedule_type": "flexible",
            "estimated_minutes": 60,
        },
    ).json()
    request = {
        "task_ids": [task["id"]],
        "start_at": "2026-11-16T00:00:00+09:00",
        "end_at": "2026-11-17T00:00:00+09:00",
    }
    from app.services import auto_schedule

    monkeypatch.setattr(
        auto_schedule, "now", lambda: datetime(2026, 11, 10, tzinfo=UTC)
    )
    response = client.post("/api/scheduling/preview", headers=auth, json=request)
    assert response.status_code == 201
    plan = response.json()
    assert (
        not plan["details"]["blocked"] and plan["details"]["google_state"] == "checked"
    )
    assert plan["blocks"][0]["start_at"] == "2026-11-16T01:00:00+00:00"
    monkeypatch.setattr(events, "MAX_PAGES", 1)
    partial = client.post("/api/scheduling/preview", headers=auth, json=request).json()
    assert (
        partial["details"]["blocked"]
        and partial["details"]["google_state"] == "partial"
    )
    approval = client.post(
        "/api/scheduling/plans/" + partial["id"] + "/approve",
        headers=auth,
        json={
            "blocks": [
                {k: b[k] for k in ("id", "start_at", "end_at")}
                for b in partial["blocks"]
            ]
        },
    )
    assert approval.status_code == 409
    assert client.get("/api/scheduled-events", headers=auth).json() == []
