"""Regression checks from full-stack code review."""

import uuid

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import ScheduledEvent
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def test_cors_allowed_and_untrusted_origins(monkeypatch):
    monkeypatch.setattr("app.main.get_settings", lambda: Settings(
        _env_file=None, cors_origins=["http://localhost:3000"],
    ))
    browser = TestClient(create_app())
    for origin, expected in (("http://localhost:3000", 200), ("https://untrusted.example", 400)):
        response = browser.options("/api/deadlines", headers={
            "Origin": origin, "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        assert response.status_code == expected
        assert response.headers.get("access-control-allow-origin") == (origin if expected == 200 else None)
    assert browser.get("/health", headers={"Origin": "http://localhost:3000"}).headers[
        "access-control-allow-origin"
    ] == "http://localhost:3000"


def test_task_timezone_limits_and_synced_delete_guard():
    auth = auth_headers("review-fixes@example.com")
    created = client.post("/api/tasks", headers=auth, json={
        "title": "KST task", "earliest_start": "2026-09-20T09:00:00+09:00",
        "latest_end": "2026-09-20T10:00:00+09:00",
    })
    assert created.status_code == 201
    task_id = created.json()["id"]
    path = f"/api/tasks/{task_id}"
    assert client.patch(path, headers=auth, json={
        "latest_end": "2026-09-20T11:00:00+09:00",
    }).status_code == 200
    assert client.patch(path, headers=auth, json={"estimated_minutes": 2147483648}).status_code == 422
    assert client.post("/api/tasks", headers=auth, json={
        "title": "Too large", "estimated_minutes": 2147483648,
    }).status_code == 422
    event_id = client.post("/api/scheduled-events", headers=auth, json={
        "task_id": task_id, "start_at": "2026-09-20T09:00:00Z", "end_at": "2026-09-20T10:00:00Z",
    }).json()["id"]
    with TestingSession() as db:
        event = db.get(ScheduledEvent, uuid.UUID(event_id))
        event.status = "synced"
        event.google_event_id = "test-remote-event"
        db.commit()
    assert client.delete(path, headers=auth).status_code == 409
    assert client.get(f"/api/scheduled-events/{event_id}", headers=auth).status_code == 200
