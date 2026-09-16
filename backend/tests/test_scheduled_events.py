"""Calendar placement lifecycle and authorization tests."""

import uuid

import pytest

from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def setup_owner():
    auth = auth_headers(f"event-{uuid.uuid4().hex}@example.com")
    task = client.post("/api/tasks", headers=auth, json={"title": "Draft"})
    assert task.status_code == 201
    return auth, task.json()["id"]


def payload(task_id):
    return {
        "task_id": task_id,
        "start_at": "2026-09-20T09:00:00+09:00",
        "end_at": "2026-09-20T10:00:00+09:00",
    }


def test_event_lifecycle():
    auth, task_id = setup_owner()
    created = client.post("/api/scheduled-events", headers=auth, json=payload(task_id))
    assert created.status_code == 201
    event = created.json()
    assert event["status"] == "recommended"
    assert event["is_user_approved"] is False
    path = f"/api/scheduled-events/{event['id']}"
    assert client.get(path, headers=auth).status_code == 200
    approved = client.patch(path, headers=auth, json={"status": "approved"})
    assert approved.status_code == 200
    assert approved.json()["is_user_approved"] is True
    assert client.patch(path, headers=auth, json={
        "start_at": "2026-09-20T11:00:00+09:00",
    }).status_code == 422
    moved = client.patch(path, headers=auth, json={
        "start_at": "2026-09-20T11:00:00+09:00",
        "end_at": "2026-09-20T12:00:00+09:00",
    })
    assert moved.status_code == 200
    cancelled = client.patch(path, headers=auth, json={"status": "cancelled"})
    assert cancelled.json()["is_user_approved"] is False
    assert client.delete(path, headers=auth).status_code == 204
    assert client.get(path, headers=auth).status_code == 404


def test_calendar_window_overlap_and_filters():
    auth, task_id = setup_owner()
    client.post("/api/scheduled-events", headers=auth, json=payload(task_id))
    params = {
        "start_from": "2026-09-20T09:30:00+09:00",
        "end_before": "2026-09-20T10:30:00+09:00",
        "task_id": task_id, "status": "recommended",
    }
    response = client.get("/api/scheduled-events", headers=auth, params=params)
    assert response.status_code == 200
    assert len(response.json()) == 1
    params["start_from"] = "2026-09-20T10:00:00+09:00"
    assert client.get("/api/scheduled-events", headers=auth, params=params).json() == []
    assert client.get("/api/scheduled-events?status=approved", headers=auth).json() == []
    assert client.get("/api/scheduled-events", headers=auth, params={
        "start_from": "2026-09-21T00:00:00Z", "end_before": "2026-09-20T00:00:00Z",
    }).status_code == 422


def test_event_ownership():
    owner, task_id = setup_owner()
    other, _ = setup_owner()
    created = client.post("/api/scheduled-events", headers=owner, json=payload(task_id)).json()
    path = f"/api/scheduled-events/{created['id']}"
    assert client.post("/api/scheduled-events", headers=other, json=payload(task_id)).status_code == 404
    assert client.get("/api/scheduled-events", headers=other).json() == []
    assert client.get(path, headers=other).status_code == 404
    assert client.patch(path, headers=other, json={"status": "approved"}).status_code == 404
    assert client.delete(path, headers=other).status_code == 404
    assert client.get("/api/scheduled-events").status_code == 401
    assert client.post("/api/scheduled-events", json=payload(task_id)).status_code == 401
    assert client.get(path).status_code == 401
    assert client.patch(path, json={"status": "approved"}).status_code == 401
    assert client.delete(path).status_code == 401


@pytest.mark.parametrize("change", [
    {"start_at": "2026-09-20T09:00:00"},
    {"end_at": "2026-09-20T09:00:00+09:00"},
    {"status": "synced"}, {"is_user_approved": True}, {"google_event_id": "fake"},
])
def test_invalid_event_create(change):
    auth, task_id = setup_owner()
    assert client.post("/api/scheduled-events", headers=auth, json={
        **payload(task_id), **change,
    }).status_code == 422


def test_protected_update_fields():
    auth, task_id = setup_owner()
    created = client.post("/api/scheduled-events", headers=auth, json=payload(task_id)).json()
    path = f"/api/scheduled-events/{created['id']}"
    for field in ("start_at", "end_at", "status"):
        assert client.patch(path, headers=auth, json={field: None}).status_code == 422
    assert client.patch(path, headers=auth, json={"status": "synced"}).status_code == 422
    assert client.patch(path, headers=auth, json={"task_id": task_id}).status_code == 422


def test_synced_event_requires_sync_workflow():
    from app.models.scheduled_event import ScheduledEvent
    from tests.test_auth import TestingSession

    auth, task_id = setup_owner()
    created = client.post("/api/scheduled-events", headers=auth, json=payload(task_id)).json()
    with TestingSession() as db:
        event = db.get(ScheduledEvent, uuid.UUID(created["id"]))
        event.status = "synced"
        event.google_event_id = "remote-event"
        db.commit()
    path = f"/api/scheduled-events/{created['id']}"
    assert client.patch(path, headers=auth, json={"status": "cancelled"}).status_code == 409
    assert client.delete(path, headers=auth).status_code == 409
