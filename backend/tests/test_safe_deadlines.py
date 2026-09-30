"""Safety-buffer CRUD, timezone arithmetic and ownership regression tests."""

import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.deadline import Deadline
from app.services.deadline_safety import calculate_safe_due_at
from tests.test_auth import TestingSession
from tests.test_deadlines import configure_test_jwt  # noqa: F401
from tests.test_sources import auth_headers, client


@pytest.fixture
def headers():
    return auth_headers(f"safe-{uuid.uuid4().hex}@example.com")


def create_deadline(headers, **changes):
    payload = {"title": "Official deadline", "due_at": "2026-10-05T18:00:00+09:00"}
    return client.post("/api/deadlines", headers=headers, json=payload | changes)


def test_safety_deadline_crud_and_persisted_inputs(headers):
    created = create_deadline(headers, safety_buffer_minutes=1440)
    assert created.status_code == 201
    item = created.json()
    path = f"/api/deadlines/{item['id']}"
    assert item["due_at"] == "2026-10-05T09:00:00Z"
    assert item["safe_due_at"] == "2026-10-04T09:00:00Z"
    assert item["safety_buffer_minutes"] == 1440
    with TestingSession() as db:
        saved = db.scalar(select(Deadline).where(Deadline.id == uuid.UUID(item["id"])))
        assert saved.safety_buffer_minutes == 1440
        assert saved.safe_due_at == datetime(2026, 10, 4, 9, tzinfo=UTC)
    assert client.get(path, headers=headers).json()["safe_due_at"] == item["safe_due_at"]
    assert client.get("/api/deadlines", headers=headers).json()[0]["safe_due_at"] == item["safe_due_at"]

    changed = client.patch(path, headers=headers, json={"safety_buffer_minutes": 180})
    assert changed.json()["safe_due_at"] == "2026-10-05T06:00:00Z"
    assert changed.json()["due_at"] == item["due_at"]
    changed = client.patch(path, headers=headers, json={"due_at": "2026-10-06T18:00:00+09:00"})
    assert changed.json()["safety_buffer_minutes"] == 180
    assert changed.json()["safe_due_at"] == "2026-10-06T06:00:00Z"
    changed = client.patch(path, headers=headers, json={"title": "Renamed"})
    assert changed.json()["safe_due_at"] == "2026-10-06T06:00:00Z"

    cleared = client.patch(path, headers=headers, json={"safety_buffer_minutes": None})
    assert cleared.status_code == 200
    assert cleared.json()["safety_buffer_minutes"] is None
    assert cleared.json()["safe_due_at"] is None
    assert cleared.json()["due_at"] == "2026-10-06T09:00:00Z"
    assert client.delete(path, headers=headers).status_code == 204


def test_unset_or_explicit_null_buffer_does_not_invent_safety_deadline(headers):
    for changes in ({}, {"safety_buffer_minutes": None}):
        created = create_deadline(headers, **changes)
        assert created.status_code == 201
        assert created.json()["safety_buffer_minutes"] is None
        assert created.json()["safe_due_at"] is None


@pytest.mark.parametrize("buffer", [0, -1, 2147483648, 1.5, True, "180"])
def test_invalid_buffer_rejected_for_create_and_patch(headers, buffer):
    assert create_deadline(headers, safety_buffer_minutes=buffer).status_code == 422
    item = create_deadline(headers, safety_buffer_minutes=180).json()
    path = f"/api/deadlines/{item['id']}"
    assert client.patch(path, headers=headers, json={"safety_buffer_minutes": buffer}).status_code == 422
    assert client.get(path, headers=headers).json()["safety_buffer_minutes"] == 180


@pytest.mark.parametrize("field", ["safe_due_at", "user_id"])
def test_client_cannot_override_derived_or_owner_fields(headers, field):
    changes = {field: "2026-10-04T09:00:00Z" if field == "safe_due_at" else str(uuid.uuid4())}
    assert create_deadline(headers, **changes).status_code == 422
    item = create_deadline(headers).json()
    assert client.patch(f"/api/deadlines/{item['id']}", headers=headers, json=changes).status_code == 422


def test_date_underflow_checks_combined_patch_and_preserves_saved_data(headers):
    assert create_deadline(
        headers, due_at="0001-01-01T00:00:00Z", safety_buffer_minutes=1,
    ).status_code == 422
    assert create_deadline(headers, due_at="0001-01-01T00:00:00+09:00").status_code == 422
    item = create_deadline(headers, due_at="0001-01-02T00:00:00Z", safety_buffer_minutes=60).json()
    path = f"/api/deadlines/{item['id']}"
    assert client.patch(path, headers=headers, json={"safety_buffer_minutes": 3000}).status_code == 422
    assert client.patch(path, headers=headers, json={"due_at": "0001-01-01T00:00:00Z"}).status_code == 422
    saved = client.get(path, headers=headers).json()
    assert saved["due_at"] == item["due_at"]
    assert saved["safety_buffer_minutes"] == 60
    # Clearing the buffer and changing the official date in one patch is valid.
    result = client.patch(path, headers=headers, json={
        "due_at": "0001-01-01T00:00:00Z", "safety_buffer_minutes": None,
    })
    assert result.status_code == 200
    assert result.json()["safe_due_at"] is None


def test_safety_deadline_ownership(headers):
    item = create_deadline(headers, safety_buffer_minutes=180).json()
    other = auth_headers(f"safe-other-{uuid.uuid4().hex}@example.com")
    path = f"/api/deadlines/{item['id']}"
    assert client.get(path, headers=other).status_code == 404
    assert client.patch(path, headers=other, json={"safety_buffer_minutes": 60}).status_code == 404
    assert client.delete(path, headers=other).status_code == 404
    assert client.get("/api/deadlines", headers=other).json() == []
    assert client.get(path, headers=headers).json()["safety_buffer_minutes"] == 180


def test_elapsed_minutes_cross_date_and_timezone_boundaries():
    due = datetime(2026, 1, 1, 1, tzinfo=timezone(timedelta(hours=9)))
    assert calculate_safe_due_at(due, 180) == datetime(2025, 12, 31, 13, tzinfo=UTC)
    assert calculate_safe_due_at(datetime(2028, 3, 1, tzinfo=UTC), 1440) == datetime(2028, 2, 29, tzinfo=UTC)
    # SQLAlchemy's SQLite representation is UTC-naive after normalized writes.
    naive_due = datetime(2026, 10, 5, 9, tzinfo=UTC).replace(tzinfo=None)
    assert calculate_safe_due_at(naive_due, 180) == datetime(2026, 10, 5, 6, tzinfo=UTC)
    assert calculate_safe_due_at(due, None) is None
