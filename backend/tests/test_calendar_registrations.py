"""Existing source/manual registrations appear immediately without new writes."""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.scheduled_event import ScheduledEvent
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

WINDOW = {
    "start_from": "2026-11-01T00:00:00+09:00",
    "end_before": "2026-11-08T00:00:00+09:00",
}


def owner():
    return auth_headers(f"calendar-registration-{uuid.uuid4().hex}@example.com")


def fixed(auth, **changes):
    result = client.post(
        "/api/tasks",
        headers=auth,
        json={
            "title": "직접 등록 회의",
            "schedule_type": "fixed",
            "earliest_start": "2026-11-01T09:00:00+09:00",
            "latest_end": "2026-11-01T10:00:00+09:00",
            **changes,
        },
    )
    assert result.status_code == 201
    return result.json()


def rows(auth, **window):
    response = client.get(
        "/api/calendar/registrations", headers=auth, params={**WINDOW, **window}
    )
    assert response.status_code == 200
    return response.json()["entries"]


def test_both_source_deadline_and_manual_registration_show_without_placement():
    auth = owner()
    source = client.post(
        "/api/sources",
        headers=auth,
        json={"source_type": "text", "original_text": "마감 2026.11.02 23:59"},
    ).json()
    deadline = client.post(
        "/api/deadlines",
        headers=auth,
        json={
            "title": "자료에서 승인한 마감",
            "source_id": source["id"],
            "due_at": "2026-11-02T23:59:00+09:00",
            "is_confirmed": True,
        },
    ).json()
    task = fixed(auth)
    with TestingSession() as db:
        before = db.scalar(select(func.count()).select_from(ScheduledEvent))
    entries = rows(auth)
    assert {(e["kind"], e["id"]) for e in entries} == {
        ("deadline", deadline["id"]),
        ("fixed_task", task["id"]),
    }
    assert next(e for e in entries if e["kind"] == "deadline")["start_at"].startswith(
        "2026-11-02T14:59:00"
    )
    with TestingSession() as db:
        assert db.scalar(select(func.count()).select_from(ScheduledEvent)) == before
    assert client.get("/api/scheduled-events", headers=auth).json() == []
    client.patch(
        f"/api/tasks/{task['id']}", headers=auth, json={"title": "수정한 회의"}
    )
    assert any(e["title"] == "수정한 회의" for e in rows(auth))
    client.delete(f"/api/tasks/{task['id']}", headers=auth)
    client.delete(f"/api/deadlines/{deadline['id']}", headers=auth)
    assert rows(auth) == []


def test_owner_scope_half_open_dates_and_no_pending_sources_or_flexible_windows():
    auth, other = owner(), owner()
    fixed(auth, schedule_type="flexible")
    fixed(auth, earliest_start=None)
    fixed(other)
    fixed(
        auth,
        earliest_start="2026-10-31T23:00:00+09:00",
        latest_end="2026-11-01T00:00:00+09:00",
    )
    crossing = fixed(
        auth,
        earliest_start="2026-10-31T23:30:00+09:00",
        latest_end="2026-11-01T00:30:00+09:00",
    )
    for date in ("2026-11-08T00:00:00+09:00", "2026-10-31T23:59:59+09:00"):
        client.post(
            "/api/deadlines", headers=auth, json={"title": "범위 밖", "due_at": date}
        )
    client.post(
        "/api/sources",
        headers=auth,
        json={"source_type": "text", "original_text": "분석 전 2026.11.03"},
    )
    assert [e["id"] for e in rows(auth)] == [crossing["id"]]
    assert client.get("/api/calendar/registrations", params=WINDOW).status_code == 401


@pytest.mark.parametrize("status", ["approved", "cancelled", "recommended"])
def test_existing_placements_do_not_get_duplicated_even_after_cancellation(status):
    auth = owner()
    task = fixed(auth)
    created = client.post(
        "/api/scheduled-events",
        headers=auth,
        json={
            "task_id": task["id"],
            "start_at": "2026-11-01T09:00:00+09:00",
            "end_at": "2026-11-01T10:00:00+09:00",
            "status": status,
        },
    )
    assert created.status_code == 201
    assert rows(auth) == []
    events = client.get("/api/scheduled-events", headers=auth).json()
    assert events[0]["task_title"] == task["title"]


@pytest.mark.parametrize(
    "change",
    [
        {"start_from": "2026-11-01T00:00:00"},
        {"end_before": "2026-11-01T00:00:00+09:00"},
        {"end_before": "2027-03-01T00:00:00+09:00"},
    ],
)
def test_invalid_calendar_ranges(change):
    assert (
        client.get(
            "/api/calendar/registrations", headers=owner(), params={**WINDOW, **change}
        ).status_code
        == 422
    )


def test_calendar_limits_are_explicit_and_results_are_not_cached(monkeypatch):
    from app.api.routes import calendar_registrations

    monkeypatch.setattr(calendar_registrations, "MAX_PER_KIND", 1)
    auth = owner()
    fixed(auth)
    fixed(auth)
    response = client.get("/api/calendar/registrations", headers=auth, params=WINDOW)
    assert len(response.json()["entries"]) == 1 and response.json()["has_more"]
    assert response.headers["cache-control"] == "no-store"
