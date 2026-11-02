"""Export tests use synthetic credentials/provider responses exclusively."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import GoogleCalendarConnection, GoogleExport
from app.services import google_calendar as google
from app.services import google_events
from app.services import google_export as transport
from tests.test_auth import TestingSession
from tests.test_google_calendar import connection_user, owner
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_google_events import connected
from tests.test_sources import configure_test_jwt as configure_test_jwt  # noqa: PLC0414

BASE = google.PREFIX + "/exports"


def deadline(setup, auth):
    response = setup.client.post(
        "/api/deadlines",
        headers=auth,
        json={
            "title": "지원 마감",
            "due_at": "2026-11-10T23:59:00+09:00",
            "is_confirmed": True,
        },
    )
    assert response.status_code == 201
    return {"kind": "deadline", "item_id": response.json()["id"]}


@pytest.fixture
def exports(setup, monkeypatch):
    auth = connected(setup)
    calls, remote = [], {}
    monkeypatch.setattr(
        google_events, "refresh_access", lambda *_: ("synthetic-token", None)
    )

    def request(token, method, identity, body=None):
        assert token == "synthetic-token"
        calls.append((method, identity))
        if method == "GET":
            return (200, remote[identity]) if identity in remote else (404, {})
        remote[identity] = {**body, "status": "confirmed"}
        return 201, remote[identity]

    monkeypatch.setattr(transport, "request", request)
    return auth, calls, remote, request


def preview(setup, auth, target):
    result = setup.client.post(BASE + "/preview", headers=auth, json=target)
    assert result.status_code == 200, result.text
    return result.json()


def send(setup, auth, target, view):
    return setup.client.post(
        BASE + "/confirm",
        headers=auth,
        json={**target, "preview_token": view["preview_token"], "confirm": True},
    )


def test_preview_does_not_write_and_confirmation_is_durable_and_idempotent(
    setup, exports
):
    auth, calls, remote, _ = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)
    assert view["status"] == "new" and view["start_at"] == "2026-11-10T14:59:00Z"
    assert view["end_at"] == "2026-11-10T15:00:00Z" and calls == []
    with TestingSession() as db:
        assert (
            db.scalar(
                select(GoogleExport).where(
                    GoogleExport.user_id == connection_user(auth)
                )
            )
            is None
        )
    first, repeat = send(setup, auth, target, view), send(setup, auth, target, view)
    assert first.status_code == repeat.status_code == 200
    assert first.json()["google_event_id"] == repeat.json()["google_event_id"]
    assert repeat.json()["already_sent"] and len(remote) == 1
    assert [method for method, _ in calls] == ["GET", "POST"]
    event = next(iter(remote.values()))
    assert not ({"description", "attendees", "attachments"} & event.keys())
    assert event["reminders"] == {"useDefault": False}
    assert first.headers["cache-control"] == "no-store"
    assert preview(setup, auth, target)["preview_token"] is None


def test_lost_provider_response_reuses_the_same_intent_and_event_id(
    setup, exports, monkeypatch
):
    auth, calls, remote, request = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)

    def lost(token, method, identity, body=None):
        result = request(token, method, identity, body)
        if method == "POST":
            raise transport.ExportError()
        return result

    monkeypatch.setattr(transport, "request", lost)
    assert send(setup, auth, target, view).status_code == 502
    retry_view = preview(setup, auth, target)
    assert retry_view["status"] == "pending"
    monkeypatch.setattr(transport, "request", request)
    assert send(setup, auth, target, retry_view).status_code == 200
    assert len(remote) == 1 and [m for m, _ in calls].count("POST") == 1


def test_changed_deleted_or_unowned_google_result_is_not_overwritten(
    setup, exports, monkeypatch
):
    auth, _, remote, request = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)

    def lost(token, method, identity, body=None):
        result = request(token, method, identity, body)
        if method == "POST":
            raise transport.ExportError()
        return result

    monkeypatch.setattr(transport, "request", lost)
    send(setup, auth, target, view)
    next(iter(remote.values()))["summary"] = "Google에서 수정"
    monkeypatch.setattr(transport, "request", request)
    assert send(setup, auth, target, preview(setup, auth, target)).status_code == 409
    assert preview(setup, auth, target)["status"] == "conflict"
    assert send(setup, auth, target, view).status_code == 409
    assert len(remote) == 1


def test_stale_preview_wrong_owner_missing_consent_and_reconnection_fail_before_google(
    setup, exports
):
    auth, calls, _, _ = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)
    assert setup.client.post(BASE + "/preview", json=target).status_code == 401
    assert (
        setup.client.post(BASE + "/preview", headers=owner(), json=target).status_code
        == 409
    )
    assert (
        setup.client.post(
            BASE + "/confirm",
            headers=auth,
            json={**target, "preview_token": view["preview_token"], "confirm": False},
        ).status_code
        == 422
    )
    setup.client.patch(
        "/api/deadlines/" + target["item_id"], headers=auth, json={"title": "변경"}
    )
    assert send(setup, auth, target, view).status_code == 409
    view = preview(setup, auth, target)
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, connection_user(auth))
        row.connected_at = datetime.now(UTC) + timedelta(seconds=1)
        db.commit()
    assert send(setup, auth, target, view).status_code == 409 and calls == []


def test_reconnect_never_creates_another_event_for_a_previously_exported_item(
    setup, exports
):
    auth, calls, _, _ = exports
    target = deadline(setup, auth)
    send(setup, auth, target, preview(setup, auth, target))
    count = len(calls)
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, connection_user(auth))
        row.connected_at = datetime.now(UTC) + timedelta(seconds=1)
        db.commit()
    view = preview(setup, auth, target)
    assert (
        view["status"] == "blocked"
        and view["preview_token"] is None
        and len(calls) == count
    )


def test_only_fixed_times_or_approved_placements_are_exported_and_family_is_deduplicated(
    setup, exports
):
    auth, _, remote, _ = exports
    task = setup.client.post(
        "/api/tasks",
        headers=auth,
        json={
            "title": "면접 준비",
            "schedule_type": "fixed",
            "earliest_start": "2026-11-10T09:00:00+09:00",
            "latest_end": "2026-11-10T10:00:00+09:00",
        },
    ).json()
    target = {"kind": "task", "item_id": task["id"]}
    assert send(setup, auth, target, preview(setup, auth, target)).status_code == 200
    event = setup.client.post(
        "/api/scheduled-events",
        headers=auth,
        json={
            "task_id": task["id"],
            "start_at": "2026-11-10T09:00:00+09:00",
            "end_at": "2026-11-10T10:00:00+09:00",
            "status": "approved",
        },
    ).json()
    assert (
        setup.client.post(
            BASE + "/preview",
            headers=auth,
            json={"kind": "event", "item_id": event["id"]},
        ).status_code
        == 409
    )
    flexible = setup.client.post(
        "/api/tasks", headers=auth, json={"title": "유동 작업"}
    ).json()
    assert (
        setup.client.post(
            BASE + "/preview",
            headers=auth,
            json={"kind": "task", "item_id": flexible["id"]},
        ).status_code
        == 422
    )
    placement = setup.client.post(
        "/api/scheduled-events",
        headers=auth,
        json={
            "task_id": flexible["id"],
            "start_at": "2026-11-10T09:00:00+09:00",
            "end_at": "2026-11-10T10:00:00+09:00",
            "status": "approved",
        },
    ).json()
    target = {"kind": "event", "item_id": placement["id"]}
    assert send(setup, auth, target, preview(setup, auth, target)).status_code == 200
    assert len(remote) == 2


def test_rotated_credentials_survive_uncertain_export(setup, exports, monkeypatch):
    auth, _, _, _ = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)
    monkeypatch.setattr(
        google_events,
        "refresh_access",
        lambda *_: ("synthetic-token", "rotated-only-test"),
    )

    def fail(*_):
        raise transport.ExportError()

    monkeypatch.setattr(transport, "send_once", fail)
    assert send(setup, auth, target, view).status_code == 502
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, connection_user(auth))
        assert (
            google.decrypt(
                google.configuration(),
                row.user_id,
                "refresh",
                row.refresh_token_ciphertext,
            )
            == "rotated-only-test"
        )


def test_preview_expiry_owner_binding_and_explicit_boolean(setup, exports, monkeypatch):
    import time

    from app.api.routes import google_exports as route

    auth, calls, _, _ = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)
    other = connected(setup)
    assert (
        setup.client.post(BASE + "/preview", headers=other, json=target).status_code
        == 404
    )
    assert send(setup, other, target, view).status_code == 409
    for value in [1, "true", None]:
        result = setup.client.post(
            BASE + "/confirm",
            headers=auth,
            json={**target, "preview_token": view["preview_token"], "confirm": value},
        )
        assert result.status_code == 422
    future = int(time.time()) + 601
    monkeypatch.setattr(route.time, "time", lambda: future)
    assert send(setup, auth, target, view).status_code == 409
    assert calls == []


@pytest.mark.parametrize("mode", ["cancelled", "gone", "unowned", "delayed"])
def test_existing_or_uncertain_remote_ids_are_never_replaced(
    setup, exports, monkeypatch, mode
):
    auth, calls, _, _ = exports
    target = deadline(setup, auth)
    view = preview(setup, auth, target)

    def response(token, method, identity, body=None):
        calls.append((method, identity))
        if mode == "gone":
            return 410, {}
        if mode == "cancelled":
            return 200, {"status": "cancelled"}
        if mode == "unowned":
            return 200, {"id": identity, "status": "confirmed"}
        return (404, {}) if method == "GET" else (409, {})

    monkeypatch.setattr(transport, "request", response)
    result = send(setup, auth, target, view)
    assert result.status_code == (502 if mode == "delayed" else 409)
    state = preview(setup, auth, target)
    assert state["status"] == ("pending" if mode == "delayed" else "conflict")
    assert len({identity for _, identity in calls}) == 1
    if mode != "delayed":
        assert all(method == "GET" for method, _ in calls)


def test_read_api_marks_only_matching_owned_export_snapshots(
    setup, exports, monkeypatch
):
    from app.schemas.google_event import GoogleEventsPage

    auth, _, remote, _ = exports
    target = deadline(setup, auth)
    send(setup, auth, target, preview(setup, auth, target))
    event = next(iter(remote.values()))

    def listed(*_):
        return GoogleEventsPage.model_validate(
            {
                "events": [
                    {
                        "id": event["id"],
                        "title": event["summary"],
                        "start_at": event["start"]["dateTime"],
                        "end_at": event["end"]["dateTime"],
                        "start_date": None,
                        "end_date": None,
                    }
                ],
                "has_more": False,
                "skipped_count": 0,
            }
        )

    monkeypatch.setattr(google_events, "list_primary", listed)
    result = setup.client.get(
        google.PREFIX + "/events",
        headers=auth,
        params={
            "start_from": "2026-11-01T00:00:00Z",
            "end_before": "2026-12-01T00:00:00Z",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["events"][0]["local_item_id"] == target["item_id"]


@pytest.mark.parametrize(
    "mode", ["oversize", "redirect", "offline", "invalid", "denied"]
)
def test_transport_is_fixed_bounded_and_never_exposes_provider_bodies(
    monkeypatch, mode
):
    import io
    from urllib.error import HTTPError, URLError

    class Reply:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, n):
            return b"x" * n if mode == "oversize" else b"invalid"

    class Opener:
        def open(self, request, timeout):
            assert (
                request.full_url.startswith(google_events.EVENTS_URL) and timeout == 10
            )
            if mode == "offline":
                raise URLError("NEVER-ECHO")
            if mode in {"redirect", "denied"}:
                raise HTTPError(
                    request.full_url,
                    302 if mode == "redirect" else 403,
                    "hidden",
                    {},
                    io.BytesIO(b"NEVER-ECHO"),
                )
            return Reply()

    monkeypatch.setattr(transport, "build_opener", lambda handler: Opener())
    with pytest.raises(transport.ExportError) as error:
        transport.request("fake", "GET", "pc" + uuid.uuid4().hex)
    assert "NEVER-ECHO" not in str(error.value)
