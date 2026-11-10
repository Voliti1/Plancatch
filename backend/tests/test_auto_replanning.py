"""Replacement is read-only until approval, atomic, owned and retry safe."""

import uuid
from datetime import UTC, datetime

import pytest

from app.models import GoogleExport, ScheduledEvent, SchedulePlan
from app.services import auto_schedule as service
from app.services import google_events
from app.services import google_sync as sync
from tests.test_auth import TestingSession
from tests.test_auto_schedule import (  # noqa: F401
    approve,
    clock,
    events,
    owner,
    preview,
    task,
)
from tests.test_google_auto_sync import automatic as automatic  # noqa: PLC0414
from tests.test_google_auto_sync import setup as setup  # noqa: PLC0414
from tests.test_sources import client, configure_test_jwt  # noqa: F401


def placed(
    auth, item, first="2026-11-17T12:00:00+09:00", last="2026-11-17T14:00:00+09:00"
):
    response = client.post(
        "/api/scheduled-events",
        headers=auth,
        json={
            "task_id": item["id"],
            "start_at": first,
            "end_at": last,
            "status": "approved",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_preview_preserves_outside_period_original_then_atomic_replacement_and_receipt_retry():
    auth = owner()
    item = task(auth)
    old = placed(auth, item)
    plan = preview(auth, [item], replace_existing=True, chunk_minutes=30).json()
    assert len(plan["blocks"]) == 4
    assert plan["details"]["replaced_blocks"][0]["id"] == old["id"]
    assert (
        "replace_existing" not in plan["request"]
    )  # Old code can safely reject by snapshot, not crash.
    assert [e["id"] for e in events(auth)] == [old["id"]]
    assert approve(auth, plan).status_code == 200
    saved = events(auth)
    assert len(saved) == 4 and old["id"] not in {e["id"] for e in saved}
    assert (
        client.get("/api/tasks/" + item["id"], headers=auth).json()["estimated_minutes"]
        == 120
    )
    assert approve(auth, plan).status_code == 200 and events(auth) == saved
    client.delete("/api/scheduled-events/" + saved[0]["id"], headers=auth)
    assert approve(auth, plan).status_code == 200 and len(events(auth)) == 3


def test_original_approval_receipt_never_restores_superseded_blocks():
    auth = owner()
    item = task(auth, estimated_minutes=60)
    original = preview(auth, [item]).json()
    assert approve(auth, original).status_code == 200
    replacement = preview(
        auth, [item], replace_existing=True, day_start_minutes=600
    ).json()
    assert approve(auth, replacement).status_code == 200
    before = events(auth)
    assert approve(auth, original).status_code == 200 and events(auth) == before
    receipt = client.get("/api/scheduling/plans/" + original["id"], headers=auth).json()
    assert receipt["saved_state"]["deleted_count"] == len(original["blocks"])


@pytest.mark.parametrize("change", ["time", "add", "cancel", "task", "deadline"])
def test_changes_after_preview_never_remove_originals(change):
    auth = owner()
    due = client.post(
        "/api/deadlines",
        headers=auth,
        json={"title": "기한", "due_at": "2026-11-18T18:00:00+09:00"},
    ).json()
    item = task(auth, deadline_id=due["id"])
    old = placed(auth, item)
    plan = preview(auth, [item], replace_existing=True).json()
    if change == "time":
        client.patch(
            "/api/scheduled-events/" + old["id"],
            headers=auth,
            json={"start_at": "2026-11-17T11:00:00+09:00"},
        )
    elif change == "add":
        placed(auth, item, "2026-11-18T12:00:00+09:00", "2026-11-18T13:00:00+09:00")
    elif change == "cancel":
        client.patch(
            "/api/scheduled-events/" + old["id"],
            headers=auth,
            json={"status": "cancelled"},
        )
    elif change == "task":
        client.patch(
            "/api/tasks/" + item["id"], headers=auth, json={"estimated_minutes": 60}
        )
    else:
        client.patch(
            "/api/deadlines/" + due["id"],
            headers=auth,
            json={"due_at": "2026-11-18T17:00:00+09:00"},
        )
    before = events(auth)
    assert approve(auth, plan).status_code == 409
    assert events(auth) == before


def test_unplaceable_task_keeps_its_slots_and_selected_subset_keeps_other_task():
    auth = owner()
    a = task(auth, title="선택할 일", estimated_minutes=60)
    b = task(auth, title="시간 부족", estimated_minutes=600, priority=1)
    old_a = placed(auth, a, "2026-11-16T13:00:00+09:00", "2026-11-16T14:00:00+09:00")
    old_b = placed(auth, b, "2026-11-16T09:00:00+09:00", "2026-11-16T10:00:00+09:00")
    plan = preview(auth, [a, b], replace_existing=True, day_end_minutes=660).json()
    assert plan["details"]["unplaced"][0]["task_id"] == b["id"]
    assert plan["blocks"][0]["start_at"] == "2026-11-16T01:00:00+00:00"
    assert approve(auth, plan).status_code == 200
    saved = events(auth)
    assert old_b["id"] in {e["id"] for e in saved} and old_a["id"] not in {
        e["id"] for e in saved
    }
    receipt = client.get("/api/scheduling/plans/" + plan["id"], headers=auth).json()
    assert {e["task_id"] for e in receipt["details"]["replaced_blocks"]} == {a["id"]}


def test_omitted_task_original_is_rechecked_before_any_mutation():
    auth = owner()
    a = task(auth, title="먼저", estimated_minutes=60, priority=5)
    b = task(auth, title="다음", estimated_minutes=60, priority=1)
    placed(auth, a, "2026-11-16T10:00:00+09:00", "2026-11-16T11:00:00+09:00")
    placed(auth, b, "2026-11-16T11:00:00+09:00", "2026-11-16T12:00:00+09:00")
    plan = preview(auth, [a, b], replace_existing=True, day_end_minutes=720).json()
    # B uses A's released slot; omitting A must preserve it and reject the overlap.
    assert (
        next(p for p in plan["blocks"] if p["task_id"] == b["id"])["start_at"]
        == "2026-11-16T01:00:00+00:00"
    )
    before = events(auth)
    response = approve(
        auth,
        plan,
        [
            {k: p[k] for k in ("id", "start_at", "end_at")}
            for p in plan["blocks"]
            if p["task_id"] == b["id"]
        ],
    )
    assert response.status_code == 409 and events(auth) == before


@pytest.mark.parametrize(
    "unsafe", ["started", "legacy", "completed", "fixed", "recurring"]
)
def test_ineligible_tasks_never_moved_or_listed(unsafe):
    auth = owner()
    item = task(auth)
    old = placed(auth, item)
    with TestingSession() as db:
        from app.models import Task

        event = db.get(ScheduledEvent, uuid.UUID(old["id"]))
        saved = db.get(Task, uuid.UUID(item["id"]))
        if unsafe == "started":
            event.start_at = datetime(2026, 11, 9, tzinfo=UTC)
        elif unsafe == "legacy":
            event.google_event_id = "legacy-id"
            event.status = "synced"
        elif unsafe == "completed":
            saved.is_completed = True
        elif unsafe == "fixed":
            saved.schedule_type = "fixed"
        else:
            saved.recurrence = {"frequency": "daily", "interval": 1}
        db.commit()
    assert (
        client.get("/api/scheduling/tasks?replace_existing=true", headers=auth).json()[
            "entries"
        ]
        == []
    )
    plan = preview(auth, [item], replace_existing=True).json()
    assert plan["blocks"] == [] and len(events(auth)) == 1


def test_started_during_review_and_expired_preview_preserve_old(monkeypatch):
    auth = owner()
    item = task(auth)
    placed(auth, item, "2026-11-10T12:05:00+09:00", "2026-11-10T14:05:00+09:00")
    plan = preview(auth, [item], replace_existing=True).json()
    before = events(auth)
    monkeypatch.setattr(
        service, "now", lambda: datetime(2026, 11, 10, 3, 6, tzinfo=UTC)
    )
    assert approve(auth, plan).status_code == 409 and events(auth) == before
    monkeypatch.setattr(
        service, "now", lambda: datetime(2026, 11, 10, 3, 16, tzinfo=UTC)
    )
    assert approve(auth, plan).status_code == 409 and events(auth) == before


def test_owner_scope_and_transaction_failure_roll_back_every_deletion(monkeypatch):
    auth = owner()
    other = owner()
    item = task(auth)
    placed(auth, item)
    assert preview(other, [item], replace_existing=True).status_code == 404
    plan = preview(auth, [item], replace_existing=True).json()
    assert approve(other, plan).status_code == 404
    before = events(auth)

    def broken(*args, **kwargs):
        raise RuntimeError("synthetic queue failure")

    with monkeypatch.context() as patch:
        patch.setattr(sync, "enqueue_task", broken)
        with pytest.raises(RuntimeError, match="synthetic queue failure"):
            approve(auth, plan)
    assert events(auth) == before
    with TestingSession() as db:
        assert db.get(SchedulePlan, uuid.UUID(plan["id"])).approved_at is None
    assert approve(auth, plan).status_code == 200


def test_google_old_copies_deleted_before_new_creates_and_failed_deletion_blocks_new(
    automatic, monkeypatch
):
    auth, _, remote, writes, _, _, rows, drain = automatic
    monkeypatch.setattr(google_events, "_fetch", lambda *_: {"items": []})
    item = task(auth, estimated_minutes=60)
    old = placed(auth, item)
    drain(force_retry=True)
    assert len(remote) == 1
    old_copy = next(r for r in rows() if str(r.item_id) == old["id"])
    plan = preview(auth, [item], replace_existing=True, chunk_minutes=30).json()
    assert approve(auth, plan).status_code == 200 and len(remote) == 1
    new = [r for r in rows() if r.item_id != old_copy.item_id and r.desired_payload]
    assert len(new) == 2
    before = len(writes)
    with TestingSession() as db:
        sync.process_row(db, new[0].id)
    assert len(writes) == before  # Run creation before deletion deliberately.
    # A provider conflict remains visible and prevents overlapping new copies.
    with TestingSession() as db:
        r = db.get(GoogleExport, old_copy.id)
        r.sync_pending = False
        r.error_code = "conflict"
        db.commit()
    with TestingSession() as db:
        sync.process_row(db, new[1].id)
    assert len(writes) == before
    with TestingSession() as db:
        r = db.get(GoogleExport, old_copy.id)
        r.sync_pending = True
        r.error_code = None
        db.commit()
    drain(force_retry=True)
    # Conflict-stopped new rows need an explicit retry after resolving the old one.
    with TestingSession() as db:
        sync.enqueue_task(db, old_copy.user_id, uuid.UUID(item["id"]), force=True)
        db.commit()
    drain(force_retry=True)
    assert len(remote) == 2 and writes[before:] == ["DELETE", "POST", "POST"]
