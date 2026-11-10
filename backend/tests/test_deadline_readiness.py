"""Preparation reads stay owner-scoped, conservative, bounded and side-effect free."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.models import ScheduledEvent, SchedulePlan, Task
from app.services import deadline_readiness as service
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(service, "now", lambda: datetime(2026, 11, 10, 3, tzinfo=UTC))


def owner():
    return auth_headers(uuid.uuid4().hex + "@example.com")


def deadline(auth, **values):
    response = client.post(
        "/api/deadlines",
        headers=auth,
        json={
            "title": "준비할 마감",
            "due_at": "2026-11-12T12:00:00+09:00",
            "is_confirmed": True,
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def task(auth, identity, **values):
    response = client.post(
        "/api/tasks",
        headers=auth,
        json={
            "title": "준비할 일",
            "deadline_id": identity,
            "schedule_type": "flexible",
            "estimated_minutes": 60,
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def event(auth, identity, **values):
    response = client.post(
        "/api/scheduled-events",
        headers=auth,
        json={
            "task_id": identity,
            "start_at": "2026-11-11T12:00:00+09:00",
            "end_at": "2026-11-11T13:00:00+09:00",
            "status": "approved",
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def read(auth, identity):
    return client.get(f"/api/deadlines/{identity}/readiness", headers=auth)


def test_auth_ownership_no_store_and_no_writes(monkeypatch):
    auth = owner()
    identity = deadline(auth)
    work = task(auth, identity)
    event(auth, work)
    assert client.get(f"/api/deadlines/{identity}/readiness").status_code == 401
    assert read(owner(), identity).status_code == 404
    assert read(auth, str(uuid.uuid4())).status_code == 404
    from app.services import google_events, google_sync

    monkeypatch.setattr(
        google_events, "list_primary", lambda *_: pytest.fail("No Google reads")
    )
    monkeypatch.setattr(
        google_sync, "enqueue_task", lambda *_: pytest.fail("No Google writes")
    )
    with TestingSession() as db:
        before = [
            db.scalar(select(func.count()).select_from(model))
            for model in (Task, ScheduledEvent, SchedulePlan)
        ]
    first = read(auth, identity)
    assert first.status_code == 200 and first.headers["cache-control"] == "no-store"
    assert first.json()["status"] == "planned" and first.json()["planned_minutes"] == 60
    assert read(auth, identity).json() == first.json()
    with TestingSession() as db:
        assert before == [
            db.scalar(select(func.count()).select_from(model))
            for model in (Task, ScheduledEvent, SchedulePlan)
        ]


def test_no_tasks_or_unknown_estimate_never_mean_prepared():
    auth = owner()
    identity = deadline(auth)
    empty = read(auth, identity).json()
    assert empty["status"] == "unknown" and empty["required_minutes"] is None
    task(auth, identity, estimated_minutes=None)
    unknown = read(auth, identity).json()
    assert unknown["unknown_task_count"] == 1 and unknown["status"] == "unknown"


def test_missing_plan_then_approved_then_cancelled_and_complete_recalculate():
    auth = owner()
    identity = deadline(auth)
    work = task(auth, identity)
    assert read(auth, identity).json()["unplanned_minutes"] == 60
    event(auth, work, status="recommended")
    assert read(auth, identity).json()["planned_minutes"] == 0
    block = event(auth, work)
    assert read(auth, identity).json()["status"] == "planned"
    client.patch(
        f"/api/scheduled-events/{block}", headers=auth, json={"status": "cancelled"}
    )
    assert read(auth, identity).json()["status"] == "attention"
    client.patch(f"/api/tasks/{work}", headers=auth, json={"is_completed": True})
    complete = read(auth, identity).json()
    assert complete["status"] == "completed" and complete["required_minutes"] == 0


def test_known_load_can_prove_shortage_even_with_unknown_work():
    auth = owner()
    identity = deadline(auth, due_at="2026-11-10T12:30:00+09:00")
    task(auth, identity, estimated_minutes=31)
    task(auth, identity, estimated_minutes=None)
    data = read(auth, identity).json()
    assert data["status"] == "shortage" and data["remaining_minutes"] == 30
    assert data["required_minutes"] is None and data["known_required_minutes"] == 31


def test_safety_deadline_crops_placements_and_passage_does_not_claim_official_expiry():
    auth = owner()
    identity = deadline(auth, safety_buffer_minutes=1440)
    work = task(auth, identity)
    event(auth, work)  # Starts exactly at safe due, so no reserved preparation time.
    data = read(auth, identity).json()
    assert data["uses_safety_deadline"] and data["target_at"] == "2026-11-11T03:00:00Z"
    assert data["planned_minutes"] == 0 and data["status"] == "attention"
    client.patch(
        f"/api/deadlines/{identity}", headers=auth, json={"safety_buffer_minutes": 3000}
    )
    assert read(auth, identity).json()["status"] == "attention"
    client.patch(
        f"/api/deadlines/{identity}",
        headers=auth,
        json={"due_at": "2026-11-09T12:00:00+09:00", "safety_buffer_minutes": None},
    )
    assert read(auth, identity).json()["status"] == "overdue"


def test_completed_work_is_done_even_after_deadline():
    auth = owner()
    identity = deadline(auth, due_at="2026-11-09T12:00:00+09:00")
    task(auth, identity, is_completed=True)
    assert read(auth, identity).json()["status"] == "completed"


def test_elapsed_duplicate_overlapping_and_beyond_window_minutes_are_not_added_twice():
    auth = owner()
    identity = deadline(auth)
    work = task(
        auth, identity, estimated_minutes=120, latest_end="2026-11-11T12:30:00+09:00"
    )
    event(auth, work)
    event(auth, work)
    event(
        auth,
        work,
        start_at="2026-11-09T12:00:00+09:00",
        end_at="2026-11-09T13:00:00+09:00",
    )
    data = read(auth, identity).json()
    assert data["planned_minutes"] == 30 and data["unplanned_minutes"] == 90
    assert data["required_minutes"] == 120  # Past work is not completion.


def test_cross_task_overlap_stays_attention_even_with_full_individual_coverage():
    auth = owner()
    identity = deadline(auth)
    event(auth, task(auth, identity))
    event(auth, task(auth, identity))
    data = read(auth, identity).json()
    assert data["status"] == "attention" and data["unplanned_minutes"] == 0
    assert any("겹칩니다" in reason for reason in data["reasons"])


def test_fixed_time_infers_estimate_and_active_placements_replace_fixed_source_time():
    auth = owner()
    identity = deadline(auth)
    work = task(
        auth,
        identity,
        schedule_type="fixed",
        estimated_minutes=None,
        earliest_start="2026-11-11T12:00:00+09:00",
        latest_end="2026-11-11T13:00:00+09:00",
    )
    assert read(auth, identity).json()["status"] == "planned"
    event(
        auth,
        work,
        start_at="2026-11-13T12:00:00+09:00",
        end_at="2026-11-13T13:00:00+09:00",
    )
    assert read(auth, identity).json()["planned_minutes"] == 0


def test_recurring_work_is_not_treated_as_one_hour_of_remaining_work():
    auth = owner()
    identity = deadline(auth)
    task(
        auth,
        identity,
        schedule_type="fixed",
        earliest_start="2026-11-11T12:00:00+09:00",
        latest_end="2026-11-11T13:00:00+09:00",
        recurrence={"frequency": "daily", "interval": 1, "count": 3},
    )
    assert read(auth, identity).json()["status"] == "unknown"


@pytest.mark.parametrize("status", ["recommended", "cancelled"])
def test_hidden_fixed_source_time_is_not_resurrected_after_any_placement(status):
    auth = owner()
    identity = deadline(auth)
    work = task(
        auth,
        identity,
        schedule_type="fixed",
        earliest_start="2026-11-11T12:00:00+09:00",
        latest_end="2026-11-11T13:00:00+09:00",
    )
    event(auth, work, status=status)
    assert read(auth, identity).json()["planned_minutes"] == 0


def test_fixed_approved_override_uses_displayed_time_not_original_time():
    auth = owner()
    identity = deadline(auth)
    work = task(
        auth,
        identity,
        schedule_type="fixed",
        earliest_start="2026-11-11T12:00:00+09:00",
        latest_end="2026-11-11T13:00:00+09:00",
    )
    event(
        auth,
        work,
        start_at="2026-11-11T14:00:00+09:00",
        end_at="2026-11-11T15:00:00+09:00",
    )
    assert read(auth, identity).json()["status"] == "planned"


@pytest.mark.parametrize("cap", ["tasks", "events"])
def test_read_caps_never_claim_complete_information(monkeypatch, cap):
    auth = owner()
    identity = deadline(auth)
    for _ in range(2):
        event(auth, task(auth, identity))
    monkeypatch.setattr(service, "MAX_TASKS" if cap == "tasks" else "MAX_EVENTS", 1)
    data = read(auth, identity).json()
    assert (
        data["truncated"]
        and data["status"] == "unknown"
        and data["required_minutes"] is None
    )


def test_other_deadline_completed_tasks_and_foreign_corrupt_links_are_excluded():
    auth, other = owner(), owner()
    identity = deadline(auth)
    event(auth, task(auth, identity))
    task(auth, deadline(auth), estimated_minutes=10000)
    task(auth, identity, estimated_minutes=10000, is_completed=True)
    foreign = task(other, deadline(other), estimated_minutes=10000)
    with TestingSession() as db:
        db.get(Task, uuid.UUID(foreign)).deadline_id = uuid.UUID(identity)
        db.commit()
    data = read(auth, identity).json()
    assert data["task_count"] == 2 and data["completed_count"] == 1
    assert data["required_minutes"] == 60 and data["status"] == "planned"


def test_partial_minutes_and_urgent_unconfirmed_dates_are_conservative():
    auth = owner()
    identity = deadline(auth, due_at="2026-11-10T12:00:30+09:00", is_confirmed=False)
    task(auth, identity, estimated_minutes=1)
    assert read(auth, identity).json()["status"] == "shortage"


def test_unconfirmed_dates_and_twenty_four_hour_threshold_remain_attention():
    auth = owner()
    identity = deadline(auth)
    event(auth, task(auth, identity))
    assert read(auth, identity).json()["status"] == "planned"
    client.patch(
        f"/api/deadlines/{identity}", headers=auth, json={"is_confirmed": False}
    )
    assert read(auth, identity).json()["status"] == "attention"
    client.patch(
        f"/api/deadlines/{identity}",
        headers=auth,
        json={"is_confirmed": True, "due_at": "2026-11-11T12:00:00+09:00"},
    )
    data = read(auth, identity).json()
    assert data["status"] == "attention" and any(
        "24시간" in reason for reason in data["reasons"]
    )
