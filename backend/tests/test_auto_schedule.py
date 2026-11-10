"""Planning never reserves a calendar; explicit approvals are atomic and retry-safe."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.models import SchedulePlan, Task
from app.services import auto_schedule as service
from app.services import google_events
from tests.test_auth import TestingSession
from tests.test_google_auto_sync import automatic as automatic  # noqa: PLC0414
from tests.test_google_auto_sync import setup as setup  # noqa: PLC0414
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

BASE = "/api/scheduling"
INPUT = {
    "start_at": "2026-11-16T00:00:00+09:00",
    "end_at": "2026-11-17T00:00:00+09:00",
    "include_google": True,
}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(service, "now", lambda: datetime(2026, 11, 10, 3, tzinfo=UTC))


def owner():
    return auth_headers(uuid.uuid4().hex + "@example.com")


def task(auth, **extra):
    r = client.post(
        "/api/tasks",
        headers=auth,
        json={
            "title": "준비할 일",
            "schedule_type": "flexible",
            "estimated_minutes": 120,
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def preview(auth, tasks, **extra):
    return client.post(
        BASE + "/preview",
        headers=auth,
        json={**INPUT, "task_ids": [t["id"] for t in tasks], **extra},
    )


def approve(auth, plan, blocks=None):
    return client.post(
        BASE + "/plans/" + plan["id"] + "/approve",
        headers=auth,
        json={
            "blocks": blocks
            if blocks is not None
            else [
                {key: b[key] for key in ["id", "start_at", "end_at"]}
                for b in plan["blocks"]
            ]
        },
    )


def events(auth):
    return client.get("/api/scheduled-events", headers=auth).json()


def fixed(auth, start="2026-11-16T09:00:00+09:00", end="2026-11-16T10:00:00+09:00"):
    return task(
        auth,
        schedule_type="fixed",
        earliest_start=start,
        latest_end=end,
        estimated_minutes=60,
    )


def test_preview_respects_safety_and_busy_times_then_approves_once_and_never_recreates_deleted_blocks():
    auth = owner()
    due = client.post(
        "/api/deadlines",
        headers=auth,
        json={
            "title": "제출",
            "due_at": "2026-11-16T14:00:00+09:00",
            "safety_buffer_minutes": 60,
        },
    ).json()
    item = task(auth, deadline_id=due["id"])
    fixed(auth)
    response = preview(auth, [item])
    assert response.status_code == 201, response.text
    plan = response.json()
    assert (
        len(plan["blocks"]) == 2
        and plan["blocks"][0]["start_at"] == "2026-11-16T01:00:00+00:00"
    )
    assert plan["details"]["tasks"][0]["uses_safety_deadline"] and not events(auth)
    assert (
        client.get("/api/tasks/" + item["id"], headers=auth).json()["earliest_start"]
        is None
    )
    result = approve(auth, plan)
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved["approved_at"] and len(saved["approved_event_ids"]) == 2
    assert all(
        e["status"] == "approved" and e["is_user_approved"] for e in events(auth)
    )
    assert (
        approve(auth, plan).json()["approved_event_ids"] == saved["approved_event_ids"]
        and len(events(auth)) == 2
    )
    for event in events(auth):
        assert (
            client.delete(
                "/api/scheduled-events/" + event["id"], headers=auth
            ).status_code
            == 204
        )
    assert approve(auth, plan).status_code == 200 and events(auth) == []


def test_stale_tasks_deadlines_and_local_calendar_are_rechecked_before_any_write():
    auth = owner()
    item = task(auth)
    plan = preview(auth, [item]).json()
    fixed(auth)
    assert approve(auth, plan).status_code == 409 and not events(auth)
    plan = preview(auth, [item]).json()
    client.patch(
        "/api/tasks/" + item["id"], headers=auth, json={"estimated_minutes": 90}
    )
    assert approve(auth, plan).status_code == 409 and not events(auth)


def test_edited_times_keep_duration_and_workday_bounds_and_overlap_checks_atomic():
    auth = owner()
    item = task(auth)
    plan = preview(auth, [item]).json()
    blocks = [
        {key: b[key] for key in ["id", "start_at", "end_at"]} for b in plan["blocks"]
    ]
    invalid = [{**blocks[0], "end_at": "2026-11-16T02:30:00Z"}, blocks[1]]
    assert approve(auth, plan, invalid).status_code == 422 and not events(auth)
    assert approve(auth, plan, [blocks[0]]).status_code == 422
    assert approve(auth, plan, [blocks[0], blocks[0]]).status_code == 422
    overlap = [
        blocks[0],
        {**blocks[1], "start_at": blocks[0]["start_at"], "end_at": blocks[0]["end_at"]},
    ]
    assert approve(auth, plan, overlap).status_code == 409 and not events(auth)
    outside = [
        {**b, "start_at": "2026-11-16T15:00:00Z", "end_at": "2026-11-16T16:00:00Z"}
        for b in blocks
    ]
    assert approve(auth, plan, outside).status_code == 422
    moved = [
        {
            **blocks[0],
            "start_at": "2026-11-16T03:00:00Z",
            "end_at": "2026-11-16T04:00:00Z",
        },
        blocks[1],
    ]
    assert approve(auth, plan, moved).status_code == 200 and len(events(auth)) == 2


def test_whole_task_selection_and_priority_do_not_leave_partial_tasks_reserved():
    auth = owner()
    large = task(auth, title="큰 작업", estimated_minutes=60, priority=5)
    small = task(auth, title="작은 작업", estimated_minutes=20, priority=1)
    plan = preview(auth, [large, small], day_end_minutes=570).json()
    assert [b["task_id"] for b in plan["blocks"]] == [small["id"]]
    assert plan["details"]["unplaced"][0]["task_id"] == large["id"]
    assert approve(auth, plan).status_code == 200 and len(events(auth)) == 1
    # Different preview IDs cannot place the same task twice.
    assert not preview(auth, [small]).json()["blocks"]
    a = task(auth, title="낮은 우선순위", estimated_minutes=30, priority=1)
    b = task(auth, title="높은 우선순위", estimated_minutes=30, priority=5)
    plan = preview(auth, [a, b]).json()
    assert plan["blocks"][0]["task_id"] == b["id"]
    only_a = [
        {key: block[key] for key in ["id", "start_at", "end_at"]}
        for block in plan["blocks"]
        if block["task_id"] == a["id"]
    ]
    assert approve(auth, plan, only_a).status_code == 200


def test_owner_scope_candidates_and_expiry(monkeypatch):
    auth = owner()
    other = owner()
    item = task(auth)
    fixed(auth)
    assert client.get(BASE + "/tasks").status_code == 401
    assert (
        client.get(BASE + "/tasks", headers=auth).json()["entries"][0]["id"]
        == item["id"]
    )
    assert client.get(BASE + "/tasks", headers=other).json()["entries"] == []
    assert preview(other, [item]).status_code == 404
    plan = preview(auth, [item]).json()
    assert client.get(BASE + "/plans/" + plan["id"], headers=other).status_code == 404
    assert approve(other, plan).status_code == 404
    monkeypatch.setattr(service, "now", lambda: datetime(2026, 11, 16, tzinfo=UTC))
    assert approve(auth, plan).status_code == 409 and not events(auth)


@pytest.mark.parametrize(
    "extra",
    [
        {"end_at": "2027-01-01T00:00:00Z"},
        {"day_start_minutes": 1080, "day_end_minutes": 540},
        {"weekdays": [True]},
        {"weekdays": [0, 0]},
        {"chunk_minutes": 10},
        {"include_google": "false"},
    ],
)
def test_bad_inputs_never_write(extra):
    auth = owner()
    item = task(auth)
    assert preview(auth, [item], **extra).status_code == 422 and not events(auth)


def test_google_failure_blocks_approval_and_google_changes_are_checked_again(
    setup, automatic, monkeypatch
):
    auth, _, remote, writes, _, _, _, drain = automatic
    item = task(auth, estimated_minutes=60)
    monkeypatch.setattr(
        google_events, "_fetch", lambda *_: {"items": [], "nextPageToken": "opaque"}
    )
    plan = preview(auth, [item]).json()
    assert (
        plan["details"]["blocked"]
        and approve(auth, plan).status_code == 409
        and writes == []
    )
    monkeypatch.setattr(google_events, "_fetch", lambda *_: {"items": []})
    plan = preview(auth, [item]).json()
    block = plan["blocks"][0]
    monkeypatch.setattr(
        google_events,
        "_fetch",
        lambda *_: {
            "items": [
                {
                    "id": "new",
                    "summary": "구글 회의",
                    "start": {"dateTime": block["start_at"]},
                    "end": {"dateTime": block["end_at"]},
                }
            ]
        },
    )
    assert approve(auth, plan).status_code == 409 and not events(auth) and writes == []
    plan = preview(auth, [item], include_google=False).json()
    assert (
        plan["details"]["google_state"] == "excluded" and not plan["details"]["blocked"]
    )
    assert approve(auth, plan).status_code == 200 and not writes
    drain()
    assert len(remote) == 1 and writes == ["POST"]
    assert approve(auth, plan).status_code == 200
    drain()
    assert writes == ["POST"]


def test_weekends_and_task_windows_are_respected_and_old_pending_plans_are_bounded():
    auth = owner()
    item = task(
        auth,
        estimated_minutes=10,
        earliest_start="2026-11-16T11:02:20+09:00",
        latest_end="2026-11-16T12:00:00+09:00",
    )
    plan = preview(auth, [item]).json()
    assert plan["blocks"][0]["start_at"] == "2026-11-16T02:05:00+00:00"
    assert plan["blocks"][0]["end_at"] == "2026-11-16T02:15:00+00:00"
    weekend = preview(
        auth,
        [item],
        start_at="2026-11-14T00:00:00+09:00",
        end_at="2026-11-15T00:00:00+09:00",
    ).json()
    assert not weekend["blocks"] and weekend["details"]["unplaced"]
    for _ in range(31):
        assert preview(auth, [item]).status_code == 201
    with TestingSession() as db:
        owner_id = db.scalar(
            select(Task.user_id).where(Task.id == uuid.UUID(item["id"]))
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(SchedulePlan)
                .where(SchedulePlan.user_id == owner_id)
            )
            == 30
        )


def test_preview_start_passes_while_reviewing_and_approval_requires_a_future_slot(
    monkeypatch,
):
    auth = owner()
    item = task(auth, estimated_minutes=30)
    monkeypatch.setattr(
        service, "now", lambda: datetime(2026, 11, 16, 0, 4, tzinfo=UTC)
    )
    plan = preview(auth, [item]).json()
    assert plan["blocks"][0]["start_at"] == "2026-11-16T00:05:00+00:00"
    monkeypatch.setattr(
        service, "now", lambda: datetime(2026, 11, 16, 0, 6, tzinfo=UTC)
    )
    response = approve(auth, plan)
    assert (
        response.status_code == 409
        and "시작 시간이 지났습니다" in response.text
        and not events(auth)
    )
