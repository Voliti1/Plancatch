"""Owner-scoped profile and category regression contracts."""
import uuid

import pytest

from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def test_profile_normalization_and_field_protection():
    headers = auth_headers(f"profile-{uuid.uuid4().hex}@example.com")
    assert client.patch("/api/auth/me", headers=headers, json={"display_name": "  새 이름  "}).json()["display_name"] == "새 이름"
    assert client.get("/api/auth/me", headers=headers).json()["display_name"] == "새 이름"
    assert client.patch("/api/auth/me", headers=headers, json={"display_name": "   "}).json()["display_name"] is None
    assert client.patch("/api/auth/me", headers=headers, json={"email": "other@example.com"}).status_code == 422
    assert client.patch("/api/auth/me", headers=headers, json={"display_name": "a" * 101}).status_code == 422
    assert client.patch("/api/auth/me", json={"display_name": "bad"}).status_code == 401


@pytest.mark.parametrize("kind", ["deadlines", "tasks"])
def test_category_create_patch_filters_and_ownership(kind):
    headers = auth_headers(f"cat-{uuid.uuid4().hex}@example.com")
    other = auth_headers(f"other-{uuid.uuid4().hex}@example.com")
    payload = {"title": "category test", "category": "career"}
    if kind == "deadlines":
        payload["due_at"] = "2026-12-03T18:00:00+09:00"
    response = client.post(f"/api/{kind}", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["category"] == "career"
    assert client.get(f"/api/{kind}?category=career", headers=headers).json()[0]["id"] == item["id"]
    assert client.get(f"/api/{kind}?category=study", headers=headers).json() == []
    assert client.get(f"/api/{kind}?category=career", headers=other).json() == []
    assert client.patch(f"/api/{kind}/{item['id']}", headers=headers, json={"category": "study"}).json()["category"] == "study"
    assert client.patch(f"/api/{kind}/{item['id']}", headers=headers, json={"category": "bad"}).status_code == 422
    assert client.get(f"/api/{kind}?category=bad", headers=headers).status_code == 422
    assert client.patch(f"/api/{kind}/{item['id']}", headers=headers, json={"category": None}).json()["category"] is None
    payload.pop("category")
    assert client.post(f"/api/{kind}", headers=headers, json=payload).json()["category"] is None


def test_category_calendar_and_combined_list():
    headers = auth_headers(f"calendar-cat-{uuid.uuid4().hex}@example.com")
    client.post("/api/deadlines", headers=headers, json={"title": "deadline", "due_at": "2026-12-03T09:00:00Z", "category": "work"})
    query = "start_from=2026-12-01T00:00:00Z&end_before=2026-12-05T00:00:00Z"
    assert client.get("/api/calendar/registrations?" + query + "&category=work", headers=headers).json()["entries"][0]["category"] == "work"
    assert client.get("/api/calendar/registrations?" + query + "&category=study", headers=headers).json()["entries"] == []
    assert client.get("/api/schedules?category=work", headers=headers).json()["entries"][0]["item"]["category"] == "work"
    assert client.get("/api/schedules?category=bad", headers=headers).status_code == 422


def test_category_migration_preserves_existing_rows_and_reverses():
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text
    migration = import_module("migrations.versions.20261126_0023_categories")
    with create_engine("sqlite://").begin() as db:
        for table in ("deadlines", "tasks"):
            db.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"))
            db.execute(text(f"INSERT INTO {table} VALUES (1, 'keep')"))
        with Operations.context(MigrationContext.configure(db)):
            migration.upgrade()
        for table in ("deadlines", "tasks"):
            assert db.execute(text(f"SELECT title, category FROM {table}")).one() == ("keep", None)
            assert any(index["name"] == f"ix_{table}_category" for index in inspect(db).get_indexes(table))
        with Operations.context(MigrationContext.configure(db)):
            migration.downgrade()
        for table in ("deadlines", "tasks"):
            assert db.execute(text(f"SELECT title FROM {table}")).scalar_one() == "keep"
            assert "category" not in {column["name"] for column in inspect(db).get_columns(table)}


def test_upcoming_deadlines_precede_expired_records():
    from datetime import UTC, datetime, timedelta
    headers = auth_headers(f"urgent-{uuid.uuid4().hex}@example.com")
    for title, days in [("expired", -1), ("later", 3), ("next", 1)]:
        client.post("/api/deadlines", headers=headers, json={"title": title, "due_at": (datetime.now(UTC) + timedelta(days=days)).isoformat()})
    response = client.get("/api/deadlines?upcoming_first=true", headers=headers)
    assert [row["title"] for row in response.json()] == ["next", "later", "expired"]


def test_dashboard_prioritizes_today_before_newer_unscheduled_tasks():
    from datetime import datetime, timedelta, UTC
    headers = auth_headers(f"today-{uuid.uuid4().hex}@example.com")
    now = datetime.now(UTC)
    response = client.post("/api/tasks", headers=headers, json={"title": "today", "schedule_type": "fixed", "earliest_start": now.isoformat(), "latest_end": (now + timedelta(minutes=30)).isoformat()})
    assert response.status_code == 201
    client.post("/api/tasks", headers=headers, json={"title": "newer"})
    rows = client.get("/api/tasks?dashboard=true", headers=headers).json()
    assert [row["title"] for row in rows] == ["today", "newer"]
