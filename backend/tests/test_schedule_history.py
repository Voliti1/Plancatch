"""History is bounded, read-only, owned, and distinguishes receipts from live events."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import ScheduledEvent, SchedulePlan, Task
from app.services import auto_schedule, schedule_history
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

BASE = "/api/scheduling/plans"
MOMENT = datetime(2026, 11, 10, 3, tzinfo=UTC)


@pytest.fixture(autouse=True)
def clock_and_provider(monkeypatch):
    monkeypatch.setattr(schedule_history, "now", lambda: MOMENT)
    monkeypatch.setattr(auto_schedule, "now", lambda: MOMENT)

    def forbidden(*args, **kwargs):
        pytest.fail("History must not contact Google or enqueue a write")

    monkeypatch.setattr("app.api.routes.google_calendar.read_owned_calendar", forbidden)
    monkeypatch.setattr("app.services.google_sync.enqueue_task", forbidden)


def owner():
    auth = auth_headers(uuid.uuid4().hex + "@example.com")
    return auth, uuid.UUID(client.get("/api/auth/me", headers=auth).json()["id"])


def seed(owner_id, *, state="pending", identity=None, created=MOMENT):
    identity = identity or uuid.uuid4()
    with TestingSession() as db:
        db.add(
            SchedulePlan(
                id=identity,
                user_id=owner_id,
                created_at=created,
                expires_at=MOMENT + timedelta(minutes=-1 if state == "expired" else 15),
                approved_at=MOMENT if state == "approved" else None,
                approved_event_ids=[] if state == "approved" else None,
                snapshot_hash="a" * 64,
                request={
                    "start_at": MOMENT.isoformat(),
                    "end_at": (MOMENT + timedelta(days=1)).isoformat(),
                },
                blocks=[],
                details={
                    "tasks": [{"id": str(uuid.uuid4()), "title": "보고서 준비"}],
                    "unplaced": [],
                    "blocked": False,
                },
            )
        )
        db.commit()
    return str(identity)


def test_owned_state_filters_are_read_only_and_timestamped():
    auth, identity = owner()
    other, foreign = owner()
    expected = {
        state: seed(identity, state=state)
        for state in ("pending", "approved", "expired")
    }
    foreign_plan = seed(foreign)
    with TestingSession() as db:
        before = db.scalar(select(func.count()).select_from(SchedulePlan))
    response = client.get(BASE, headers=auth)
    assert (
        response.status_code == 200 and response.headers["cache-control"] == "no-store"
    )
    assert {e["id"] for e in response.json()["entries"]} == set(expected.values())
    for state, plan_id in expected.items():
        rows = client.get(BASE, params={"state": state}, headers=auth).json()["entries"]
        assert (
            len(rows) == 1
            and rows[0]["id"] == plan_id
            and rows[0]["state"] == state
        )
        assert datetime.fromisoformat(rows[0]["created_at"]).tzinfo is not None
    assert client.get(BASE + "/" + foreign_plan, headers=auth).status_code == 404
    assert (
        client.get(BASE + "/" + expected["approved"], headers=other).status_code == 404
    )
    with TestingSession() as db:
        assert db.scalar(select(func.count()).select_from(SchedulePlan)) == before


def test_stable_cursor_with_equal_times_and_new_record_between_pages():
    auth, identity = owner()
    ids = [seed(identity, identity=uuid.UUID(int=n)) for n in range(1, 6)]
    first = client.get(BASE, params={"limit": 2}, headers=auth).json()
    assert [e["id"] for e in first["entries"]] == ids[::-1][:2]
    seed(identity, created=MOMENT + timedelta(seconds=1))
    found = [e["id"] for e in first["entries"]]
    cursor = first["next_cursor"]
    while cursor:
        page = client.get(
            BASE,
            params={
                "limit": 2,
                "before_at": cursor["created_at"],
                "before_id": cursor["id"],
            },
            headers=auth,
        )
        assert page.status_code == 200, page.text
        found += [e["id"] for e in page.json()["entries"]]
        cursor = page.json()["next_cursor"]
    assert found == ids[::-1] and len(set(found)) == 5


def test_current_counts_do_not_rewrite_approval_snapshot_or_expose_foreign_events():
    auth, identity = owner()
    _, foreign = owner()
    plan_id = seed(identity, state="approved")
    ids = [uuid.uuid4() for _ in range(5)]
    start = MOMENT + timedelta(days=1)
    with TestingSession() as db:
        task = Task(
            id=uuid.uuid4(), user_id=identity, title="준비", estimated_minutes=60
        )
        other = Task(id=uuid.uuid4(), user_id=foreign, title="비공개 다른 사람")
        db.add_all([task, other])
        db.flush()
        for n in (0, 1, 2, 4):
            db.add(
                ScheduledEvent(
                    id=ids[n],
                    user_id=foreign if n == 4 else identity,
                    task_id=other.id if n == 4 else task.id,
                    start_at=start + timedelta(hours=1 if n == 1 else 0),
                    end_at=start + timedelta(hours=2 if n == 1 else 1),
                    status="cancelled" if n == 2 else "approved",
                )
            )
        plan = db.get(SchedulePlan, uuid.UUID(plan_id))
        plan.approved_event_ids = [str(i) for i in ids]
        plan.blocks = [
            {
                "id": str(i),
                "task_id": str(task.id),
                "title": "준비",
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(hours=1)).isoformat(),
            }
            for i in ids
        ]
        db.commit()
    expected = {
        "active_count": 2,
        "changed_count": 1,
        "deleted_count": 2,
        "inactive_count": 1,
    }
    response = client.get(BASE, headers=auth)
    assert response.json()["entries"][0]["saved_state"] == expected
    assert "비공개" not in response.text
    detail = client.get(BASE + "/" + plan_id, headers=auth).json()
    assert (
        detail["saved_state"] == expected
        and detail["blocks"][1]["start_at"] == start.isoformat()
    )
    with TestingSession() as db:
        assert len(db.get(SchedulePlan, uuid.UUID(plan_id)).approved_event_ids) == 5


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 21},
        {"state": "unknown"},
        {"before_id": str(uuid.uuid4())},
        {"before_at": "2026-11-10T03:00:00Z"},
        {"before_at": "2026-11-10T03:00:00", "before_id": str(uuid.uuid4())},
        {"before_at": "0001-01-01T00:00:00+09:00", "before_id": str(uuid.uuid4())},
    ],
)
def test_invalid_history_input_and_auth(params):
    auth, _ = owner()
    assert client.get(BASE, params=params, headers=auth).status_code == 422
    assert client.get(BASE).status_code == 401


def test_expired_records_survive_new_preview_within_the_same_recent_cap():
    auth, identity = owner()
    old = seed(identity, state="expired")
    task_id = uuid.uuid4()
    with TestingSession() as db:
        db.add(Task(id=task_id, user_id=identity, title="준비", schedule_type="flexible", estimated_minutes=60))
        db.commit()
    for _ in range(30):
        assert (
            client.post(
                "/api/scheduling/preview",
                headers=auth,
                json={
                "task_ids": [str(task_id)],
                    "start_at": "2026-11-16T00:00:00+09:00",
                    "end_at": "2026-11-17T00:00:00+09:00",
                    "include_google": False,
                },
            ).status_code
            == 201
        )
        if _ == 0:
            assert client.get(BASE + "/" + old, headers=auth).status_code == 200
    assert client.get(BASE + "/" + old, headers=auth).status_code == 404
    with TestingSession() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(SchedulePlan)
                .where(SchedulePlan.user_id == identity)
            )
            == 30
        )
