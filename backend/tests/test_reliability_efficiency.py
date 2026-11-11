"""Regression checks for occurrence metadata and bounded sync/read query work."""

import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, select

from app.models import (
    Deadline,
    GoogleCalendarConnection,
    GoogleExport,
    ScheduledEvent,
    Task,
)
from app.services import deadline_readiness, google_sync
from app.services.extraction import MAX_HTML_DEPTH, ExtractionError, PageParser
from tests.test_auth import TestingSession, engine
from tests.test_google_calendar import connection_user
from tests.test_recurrence import create
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


@contextmanager
def statements():
    reads = []

    def capture(_conn, _cursor, statement, *_):
        if statement.lstrip().upper().startswith("SELECT"):
            reads.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield reads
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def owner():
    auth = auth_headers(uuid.uuid4().hex + "@example.com")
    return auth, connection_user(auth)


@pytest.mark.parametrize("has_connection", [False, True])
def test_unavailable_google_scope_does_not_scan_local_blocks_or_exports(has_connection):
    _, identity = owner()
    with TestingSession() as db:
        task = Task(
            user_id=identity,
            title="검사 작업",
            schedule_type="flexible",
            estimated_minutes=60,
        )
        deadline = Deadline(
            user_id=identity,
            title="검사 마감",
            due_at=datetime(2026, 12, 1, tzinfo=UTC),
        )
        db.add_all([task, deadline])
        db.flush()
        for _ in range(100):
            db.add(
                ScheduledEvent(
                    user_id=identity,
                    task_id=task.id,
                    status="approved",
                    is_user_approved=True,
                    start_at=datetime(2026, 11, 11, tzinfo=UTC),
                    end_at=datetime(2026, 11, 11, 1, tzinfo=UTC),
                )
            )
        if has_connection:
            db.add(
                GoogleCalendarConnection(
                    user_id=identity,
                    scopes="unrelated-scope",
                    refresh_token_ciphertext="synthetic-unused",
                    connected_at=datetime.now(UTC),
                )
            )
        db.commit()
        task_id, deadline_id = task.id, deadline.id
    with TestingSession() as db, statements() as reads:
        google_sync.enqueue_task(db, identity, task_id)
        google_sync.enqueue_deadline(db, identity, deadline_id)
        assert len(reads) <= 2
        assert all("google_calendar_connections" in sql for sql in reads)
    with TestingSession() as db:
        assert (
            db.scalar(select(GoogleExport.id).where(GoogleExport.user_id == identity))
            is None
        )


def test_occurrence_completion_stamps_preserves_and_clears_timestamp(monkeypatch):
    auth, _ = owner()
    task = create(auth).json()
    path = f"/api/tasks/{task['id']}/occurrences"
    query = {"original_start": "2026-11-09T23:30:00+09:00"}
    response = client.patch(
        path, headers=auth, params=query, json={"is_completed": True}
    )
    assert response.status_code == 200
    completed = response.json()
    assert completed["is_completed"] and completed["completed_at"] is not None
    assert (
        client.get("/api/tasks/" + task["id"], headers=auth).json()["completed_at"]
        is None
    )
    edited_response = client.patch(
        path, headers=auth, params=query, json={"title": "완료 후 제목 수정"}
    )
    assert edited_response.status_code == 200, edited_response.text
    edited = edited_response.json()
    assert edited["completed_at"] == completed["completed_at"]
    # Existing malformed completed records are repaired by the next owned edit.
    with TestingSession() as db:
        db.get(Task, uuid.UUID(completed["id"])).completed_at = None
        db.commit()
    repaired = client.patch(
        path, headers=auth, params=query, json={"title": "시각 복구"}
    ).json()
    assert repaired["completed_at"] is not None
    undone = client.patch(
        path, headers=auth, params=query, json={"is_completed": False}
    ).json()
    assert not undone["is_completed"] and undone["completed_at"] is None


def test_completed_series_occurrence_inherits_existing_completion_time():
    auth, _ = owner()
    task = create(auth, is_completed=True).json()
    result = client.patch(
        f"/api/tasks/{task['id']}/occurrences",
        headers=auth,
        params={"original_start": "2026-11-09T23:30:00+09:00"},
        json={"title": "완료한 회차 이름만 수정"},
    ).json()
    assert result["completed_at"] == task["completed_at"] and result["is_completed"]


def test_preparation_reads_use_fixed_queries_and_skip_large_unused_fields(monkeypatch):
    _, identity = owner()
    at = datetime(2026, 11, 10, tzinfo=UTC)
    monkeypatch.setattr(deadline_readiness, "now", lambda: at)
    with TestingSession() as db:
        deadline = Deadline(
            user_id=identity,
            title="검사 마감",
            due_at=at + timedelta(days=10),
            is_confirmed=True,
        )
        db.add(deadline)
        db.flush()
        for i in range(30):
            task = Task(
                user_id=identity,
                deadline_id=deadline.id,
                title="검사 작업",
                description="LARGE_UNUSED" * 1000,
                schedule_type="flexible",
                estimated_minutes=60,
            )
            db.add(task)
            db.flush()
            start = at + timedelta(hours=i + 1)
            db.add(
                ScheduledEvent(
                    user_id=identity,
                    task_id=task.id,
                    status="approved",
                    is_user_approved=True,
                    start_at=start,
                    end_at=start + timedelta(hours=1),
                )
            )
        db.commit()
        deadline_id = deadline.id
    with TestingSession() as db:
        deadline = db.get(Deadline, deadline_id)
        with statements() as reads:
            result = deadline_readiness.assess(db, identity, deadline)
            assert result.status == "planned" and result.planned_minutes == 1800
        assert (
            len(reads) == 3
        )  # Tasks, presence of placements, and projected intervals.
        assert not any(
            "tasks.description" in sql or "scheduled_events.sync_error" in sql
            for sql in reads
        )


def test_pathological_html_stops_early_and_nested_visibility_is_preserved():
    parser = PageParser()
    with pytest.raises(ExtractionError, match="html_too_complex"):
        parser.feed("<div>" * (MAX_HTML_DEPTH + 1000))
    assert len(parser.stack) == MAX_HTML_DEPTH
    parser = PageParser()
    parser.feed(
        "<main><nav><div><p>HIDDEN_NAV</p></div></nav>"
        '<div hidden><div>HIDDEN_CONTENT<input type="password"></div></div>'
        "<section><div><p>접수 마감 2026.11.20 18:00</p></div></section></main>"
    )
    assert parser.main == ["접수 마감 2026.11.20 18:00"] and not parser.password_form
