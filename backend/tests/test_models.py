"""Tests for the core planning database metadata."""

from app import models  # noqa: F401
from app.db.base import Base


def test_core_planning_tables_are_registered() -> None:
    expected_tables = {
        "users",
        "sources",
        "deadlines",
        "tasks",
        "scheduled_events",
    }

    assert expected_tables.issubset(Base.metadata.tables)


def test_scheduled_events_include_google_sync_fields() -> None:
    columns = Base.metadata.tables["scheduled_events"].columns

    assert "google_calendar_id" in columns
    assert "google_event_id" in columns
    assert "sync_error" in columns
