"""Calendar capacity is owner-scoped; uncertainty never becomes an optimistic result."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import event

from app.models import Task
from app.services import auto_schedule, capacity_risk
from tests.test_auth import TestingSession, engine
from tests.test_deadline_readiness import clock, deadline, owner, task  # noqa: F401
from tests.test_deadline_readiness import event as placement
from tests.test_sources import client, configure_test_jwt  # noqa: F401


def risk(auth, identity, google=False):
    response = client.get(
        f"/api/deadlines/{identity}/readiness"
        + ("?include_google=true" if google else ""),
        headers=auth,
    )
    assert response.status_code == 200, response.text
    return response.json()["capacity_risk"]


def profile(auth, weekly=None, exceptions=None):
    path = "/api/scheduling/availability"
    value = client.get(path, headers=auth).json()
    if weekly is not None:
        value["weekly"] = weekly
    if exceptions is not None:
        value["exceptions"] = exceptions
    response = client.put(path, headers=auth, json=value)
    assert response.status_code == 200, response.text


def link(auth, child, parent):
    path = f"/api/tasks/{child}/dependencies"
    value = client.get(path, headers=auth).json()
    response = client.put(
        path,
        headers=auth,
        json={"revision": value["revision"], "predecessor_ids": [parent]},
    )
    assert response.status_code == 200, response.text


def test_default_capacity_proves_a_placement_without_writing_calendar_or_counting_wall_clock_as_working_time():
    auth = owner()
    due = deadline(auth)
    task(auth, due)
    value = risk(auth, due)
    assert (
        value["level"] == "feasible"
        and value["working_minutes"] == 1080
        and value["free_minutes"] == 1080
    )
    assert (
        value["to_schedule_minutes"] == 60
        and value["unplaced_minutes"] == 0
        and value["reserved_minutes"] == 0
    )
    assert client.get("/api/scheduled-events", headers=auth).json() == []
    assert value["google_state"] == "excluded"


def test_holiday_and_weekly_settings_reduce_capacity_and_can_prove_shortage():
    auth = owner()
    due = deadline(auth)
    task(auth, due, estimated_minutes=600)
    profile(auth, exceptions=[{"date": "2026-11-11", "intervals": []}])
    value = risk(auth, due)
    assert value["working_minutes"] == 540 and value["level"] == "insufficient"
    profile(auth, weekly=[], exceptions=[])
    assert risk(auth, due)["free_minutes"] == 0


def test_other_deadlines_fixed_work_blocks_capacity_but_foreign_work_never_does():
    auth = owner()
    due = deadline(auth)
    task(auth, due, estimated_minutes=400)
    foreign = owner()
    other = deadline(foreign)
    task(
        foreign,
        other,
        schedule_type="fixed",
        earliest_start="2026-11-10T12:00:00+09:00",
        latest_end="2026-11-12T12:00:00+09:00",
    )
    assert risk(auth, due)["free_minutes"] == 1080
    own_other = deadline(auth)
    task(
        auth,
        own_other,
        schedule_type="fixed",
        earliest_start="2026-11-10T12:00:00+09:00",
        latest_end="2026-11-11T18:00:00+09:00",
    )
    value = risk(auth, due)
    assert value["free_minutes"] == 180 and value["level"] == "insufficient"


def test_recurring_busy_work_respects_excluded_occurrences():
    auth = owner()
    due = deadline(auth)
    task(auth, due)
    busy = task(
        auth,
        deadline(auth),
        schedule_type="fixed",
        earliest_start="2026-11-10T09:00:00+09:00",
        latest_end="2026-11-10T18:00:00+09:00",
        recurrence={"frequency": "daily", "interval": 1, "count": 3},
    )
    assert risk(auth, due)["free_minutes"] == 0
    client.delete(
        f"/api/tasks/{busy}/occurrences?original_start=2026-11-11T00:00:00Z",
        headers=auth,
    )
    assert risk(auth, due)["free_minutes"] == 540


def test_existing_self_placement_is_counted_once_while_overlap_with_other_work_requires_attention():
    auth = owner()
    due = deadline(auth)
    work = task(auth, due)
    placement(auth, work)
    placement(auth, work)
    value = risk(auth, due)
    assert (
        value["level"] == "feasible"
        and value["reserved_minutes"] == 60
        and value["to_schedule_minutes"] == 0
    )
    task(
        auth,
        deadline(auth),
        schedule_type="fixed",
        earliest_start="2026-11-11T12:30:00+09:00",
        latest_end="2026-11-11T13:00:00+09:00",
    )
    value = risk(auth, due)
    assert value["reserved_minutes"] == 30 and value["level"] == "attention"


def test_short_individual_window_is_shortage_even_with_lots_of_total_free_time():
    auth = owner()
    due = deadline(auth)
    task(
        auth,
        due,
        earliest_start="2026-11-11T12:00:00+09:00",
        latest_end="2026-11-11T12:30:00+09:00",
    )
    value = risk(auth, due)
    assert value["level"] == "insufficient" and value["free_minutes"] == 1080
    assert any("기한 사이" in reason for reason in value["reasons"])


def test_missing_or_recurring_estimates_and_horizon_caps_never_show_feasible():
    auth = owner()
    due = deadline(auth)
    task(auth, due, estimated_minutes=None)
    value = risk(auth, due)
    assert value["level"] == "unknown" and value["required_minutes"] is None
    future = deadline(auth, due_at="2027-02-01T12:00:00+09:00")
    task(auth, future)
    value = risk(auth, future)
    assert (
        value["level"] == "unknown"
        and value["incomplete"]
        and any("31일" in r for r in value["reasons"])
    )


def test_unfinished_prerequisites_outside_the_deadline_are_included_in_workload():
    auth = owner()
    due = deadline(auth)
    child = task(auth, due)
    parent = task(auth, deadline(auth), estimated_minutes=2000)
    link(auth, child, parent)
    value = risk(auth, due)
    assert (
        value["prerequisite_count"] == 1
        and value["required_minutes"] == 2060
        and value["level"] == "insufficient"
    )


def test_completed_prerequisite_does_not_pull_its_unfinished_ancestors_back_into_workload():
    auth = owner()
    due = deadline(auth)
    child = task(auth, due)
    ancestor = task(auth, deadline(auth), estimated_minutes=100000)
    parent = task(auth, deadline(auth), is_completed=True)
    with TestingSession() as db:
        db.get(Task, uuid.UUID(parent)).completed_at = datetime(2026, 11, 9, tzinfo=UTC)
        db.commit()
    link(auth, parent, ancestor)
    link(auth, child, parent)
    value = risk(auth, due)
    assert (
        value["prerequisite_count"] == 1
        and value["required_minutes"] == 60
        and value["level"] == "feasible"
    )


def test_wrong_order_in_existing_placements_cannot_be_reported_as_a_good_plan():
    auth = owner()
    due = deadline(auth)
    parent = task(auth, due)
    child = task(auth, due)
    link(auth, child, parent)
    placement(
        auth,
        parent,
        start_at="2026-11-11T15:00:00+09:00",
        end_at="2026-11-11T16:00:00+09:00",
    )
    placement(
        auth,
        child,
        start_at="2026-11-11T13:00:00+09:00",
        end_at="2026-11-11T14:00:00+09:00",
    )
    before = client.get("/api/scheduled-events", headers=auth).json()
    value = risk(auth, due)
    assert value["level"] == "attention" and value["reserved_minutes"] == 60
    assert client.get("/api/scheduled-events", headers=auth).json() == before


def test_work_placed_after_deadline_or_in_a_holiday_requires_adjustment():
    auth = owner()
    due = deadline(auth)
    work = task(auth, due)
    placement(
        auth,
        work,
        start_at="2026-11-13T12:00:00+09:00",
        end_at="2026-11-13T13:00:00+09:00",
    )
    assert risk(auth, due)["level"] == "attention"


def test_greedy_failure_is_attention_not_a_false_mathematical_shortage(monkeypatch):
    auth = owner()
    due = deadline(auth)
    task(auth, due)
    monkeypatch.setattr(capacity_risk, "allocate", lambda *args: None)
    value = risk(auth, due)
    assert (
        value["level"] == "attention"
        and value["free_minutes"] > value["required_minutes"]
    )


def test_google_requires_opt_in_and_partial_or_failed_reads_never_show_available_time(
    monkeypatch,
):
    auth = owner()
    due = deadline(auth)
    task(auth, due)
    calls = []

    def partial(*args):
        calls.append(True)
        return [], {"google_state": "partial", "blocked": True}, None

    monkeypatch.setattr(auto_schedule, "external_busy", partial)
    assert risk(auth, due)["level"] == "feasible" and not calls
    value = risk(auth, due, True)
    assert (
        value["level"] == "unknown"
        and value["incomplete"]
        and value["google_state"] == "partial"
        and len(calls) == 1
    )
    assert value["free_minutes"] is None and value["reserved_minutes"] is None


def test_complete_google_busy_intervals_are_removed_from_capacity(monkeypatch):
    auth = owner()
    due = deadline(auth)
    task(auth, due, estimated_minutes=1000)
    monkeypatch.setattr(
        auto_schedule,
        "external_busy",
        lambda *args: (
            [
                (
                    datetime(2026, 11, 11, 0, tzinfo=UTC),
                    datetime(2026, 11, 11, 9, tzinfo=UTC),
                )
            ],
            {"google_state": "checked", "blocked": False},
            None,
        ),
    )
    value = risk(auth, due, True)
    assert value["free_minutes"] == 540 and value["level"] == "insufficient"


def test_global_calendar_cap_never_claims_good_information(monkeypatch):
    auth = owner()
    due = deadline(auth)
    task(auth, due)
    for _ in range(2):
        placement(auth, task(auth, deadline(auth)))
    monkeypatch.setattr(capacity_risk, "MAX_CALENDAR_ROWS", 1)
    assert risk(auth, due)["level"] == "unknown"


def test_dependency_closure_cap_is_explicitly_incomplete(monkeypatch):
    auth = owner()
    due = deadline(auth)
    child = task(auth, due)
    parent = task(auth, deadline(auth))
    ancestor = task(auth, deadline(auth))
    link(auth, child, parent)
    link(auth, parent, ancestor)
    monkeypatch.setattr(capacity_risk, "MAX_TASKS", 2)
    value = risk(auth, due)
    assert (
        value["level"] == "unknown"
        and value["incomplete"]
        and value["free_minutes"] is None
    )


def test_deadline_changed_during_google_read_is_reloaded_and_not_marked_feasible(
    monkeypatch,
):
    auth = owner()
    due = deadline(auth)
    task(auth, due)

    def changed(*args):
        response = client.patch(
            f"/api/deadlines/{due}",
            headers=auth,
            json={"due_at": "2026-11-13T12:00:00+09:00"},
        )
        assert response.status_code == 200
        return [], {"google_state": "checked", "blocked": False}, None

    monkeypatch.setattr(auto_schedule, "external_busy", changed)
    value = risk(auth, due, True)
    assert (
        value["level"] == "unknown"
        and value["incomplete"]
        and value["free_minutes"] is None
    )
    assert value["checked_until"] == "2026-11-13T03:00:00Z"


def test_unknown_task_does_not_hide_a_provable_shortage_from_known_work():
    auth = owner()
    due = deadline(auth, due_at="2026-11-10T12:30:00+09:00")
    task(auth, due, estimated_minutes=31)
    task(auth, due, estimated_minutes=None)
    value = risk(auth, due)
    assert (
        value["level"] == "insufficient"
        and value["required_minutes"] is None
        and value["known_required_minutes"] == 31
    )


def test_deep_prerequisite_chain_uses_bounded_queries_instead_of_one_query_per_task():
    auth = owner()
    due = deadline(auth)
    child = task(auth, due, estimated_minutes=5)
    previous = child
    for _ in range(20):
        parent = task(auth, deadline(auth), estimated_minutes=5)
        link(auth, previous, parent)
        previous = parent
    selects = []

    def count(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        value = risk(auth, due)
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert value["prerequisite_count"] == 20 and value["level"] == "feasible"
    assert len(selects) < 25
