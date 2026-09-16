"""Task lifecycle, validation, and ownership regression tests."""

import uuid

import pytest

from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def headers():
    return auth_headers(f"task-{uuid.uuid4().hex}@example.com")


def make_deadline(auth):
    response = client.post("/api/deadlines", headers=auth, json={
        "title": "Deadline", "due_at": "2026-09-30T18:00:00+09:00",
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_task_lifecycle_and_filters():
    auth = headers()
    deadline_id = make_deadline(auth)
    response = client.post("/api/tasks", headers=auth, json={
        "title": "Write application", "deadline_id": deadline_id,
        "estimated_minutes": 60,
    })
    assert response.status_code == 201
    task = response.json()
    path = f"/api/tasks/{task['id']}"
    assert task["completed_at"] is None
    assert client.get(path, headers=auth).json()["id"] == task["id"]
    assert len(client.get("/api/tasks", headers=auth, params={
        "deadline_id": deadline_id, "is_completed": False, "schedule_type": "flexible",
    }).json()) == 1
    assert client.get("/api/tasks?is_completed=true", headers=auth).json() == []
    assert client.get("/api/tasks?schedule_type=fixed", headers=auth).json() == []
    assert client.get(f"/api/tasks?deadline_id={uuid.uuid4()}", headers=auth).json() == []
    done = client.patch(path, headers=auth, json={"is_completed": True}).json()
    assert done["is_completed"] is True
    assert done["completed_at"] is not None
    repeated = client.patch(path, headers=auth, json={"is_completed": True}).json()
    assert repeated["completed_at"] == done["completed_at"]
    reopened = client.patch(path, headers=auth, json={
        "is_completed": False, "deadline_id": None, "title": "Updated",
    }).json()
    assert reopened["completed_at"] is None
    assert reopened["deadline_id"] is None
    assert reopened["title"] == "Updated"
    assert client.delete(path, headers=auth).status_code == 204
    assert client.get(path, headers=auth).status_code == 404


def test_task_ownership_and_deadline_links():
    owner, other = headers(), headers()
    deadline_id = make_deadline(owner)
    task_id = client.post("/api/tasks", headers=owner, json={"title": "Private"}).json()["id"]
    path = f"/api/tasks/{task_id}"
    assert client.get("/api/tasks", headers=other).json() == []
    assert client.get(path, headers=other).status_code == 404
    assert client.patch(path, headers=other, json={"title": "Intrusion"}).status_code == 404
    assert client.delete(path, headers=other).status_code == 404
    for invalid_id in (deadline_id, str(uuid.uuid4())):
        assert client.post("/api/tasks", headers=other, json={
            "title": "Bad link", "deadline_id": invalid_id,
        }).status_code == 404
    other_task = client.post("/api/tasks", headers=other, json={"title": "Own"}).json()
    assert client.patch(f"/api/tasks/{other_task['id']}", headers=other, json={
        "deadline_id": deadline_id,
    }).status_code == 404


@pytest.mark.parametrize("payload", [
    {"title": " "}, {"priority": 0}, {"priority": 6}, {"estimated_minutes": 0},
    {"schedule_type": "unknown"}, {"earliest_start": "2026-09-20T09:00:00"},
    {"earliest_start": "2026-09-20T10:00:00Z", "latest_end": "2026-09-20T09:00:00Z"},
])
def test_invalid_task_input(payload):
    assert client.post("/api/tasks", headers=headers(), json={
        "title": "Task", **payload,
    }).status_code == 422


def test_partial_update_validates_saved_window_and_nulls():
    auth = headers()
    task = client.post("/api/tasks", headers=auth, json={
        "title": "Task", "earliest_start": "2026-09-20T09:00:00Z",
        "latest_end": "2026-09-20T10:00:00Z", "is_completed": True,
    }).json()
    assert task["completed_at"] is not None
    path = f"/api/tasks/{task['id']}"
    assert client.patch(path, headers=auth, json={
        "earliest_start": "2026-09-20T11:00:00Z",
    }).status_code == 422
    for field in ("title", "priority", "schedule_type", "is_completed"):
        assert client.patch(path, headers=auth, json={field: None}).status_code == 422
    assert client.patch(path, headers=auth, json={"earliest_start": None}).status_code == 200


def test_tasks_require_authentication():
    path = f"/api/tasks/{uuid.uuid4()}"
    assert client.get("/api/tasks").status_code == 401
    assert client.get(path).status_code == 401
    assert client.post("/api/tasks", json={"title": "Task"}).status_code == 401
    assert client.patch(path, json={"title": "Task"}).status_code == 401
    assert client.delete(path).status_code == 401
