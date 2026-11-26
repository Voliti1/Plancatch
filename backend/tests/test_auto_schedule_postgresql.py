"""Migration proof in a private rollback-only PostgreSQL schema."""

import os
import uuid
from datetime import UTC, datetime, timedelta
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import Response
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.api.routes.schedules import list_schedules
from app.models import Deadline, ScheduledEvent, SchedulePlan, Task, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(
    os.environ.get("PLANCATCH_TEST_POSTGRES") != "1", reason="PostgreSQL opt-in"
)


def test_plan_table_upgrade_preserves_tasks_and_can_retain_approval_receipts(pg):
    schema = pg.get_execution_options()["schema_translate_map"][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert (
        schema.startswith("plancatch_test_")
        and pg.scalar(text("SELECT current_schema()")) == schema
    )
    migration = import_module("migrations.versions.20261110_0015_schedule_plans")
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()  # Only this fixture's private schema; the outer transaction rolls back.
    owner, task_id, plan_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    pg.execute(
        User.__table__.insert().values(
            id=owner, email=f"{owner}@example.com", password_hash="synthetic-only"
        )
    )
    pg.execute(
        Task.__table__.insert().values(
            id=task_id, user_id=owner, title="기존 할 일", estimated_minutes=60
        )
    )
    def columns():
        # SQLAlchemy type objects compare by identity; compare their physical SQL form.
        return {
            c["name"]: {**c, "type": str(c["type"])}
            for c in inspect(pg).get_columns("tasks", schema=schema)
        }

    before = columns()
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    assert pg.scalar(select(Task.title).where(Task.id == task_id)) == "기존 할 일"
    assert before == columns()
    pg.execute(
        SchedulePlan.__table__.insert().values(
            id=plan_id,
            user_id=owner,
            request={},
            snapshot_hash="a" * 64,
            blocks=[],
            details={},
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
        )
    )
    assert (
        pg.scalar(select(SchedulePlan.id).where(SchedulePlan.id == plan_id)) == plan_id
    )
    assert (
        inspect(pg).get_foreign_keys("schedule_plans", schema=schema)[0]["options"][
            "ondelete"
        ]
        == "CASCADE"
    )


def test_mixed_schedule_query_keeps_confirmed_calendar_times_and_skips_cancelled_blocks(pg):
    owner = User(email="placement-test@example.com", password_hash="synthetic-only")
    start = datetime(2027, 1, 1, 1, tzinfo=UTC)
    end = start + timedelta(hours=1)
    with Session(pg) as db:
        db.add(owner)
        db.flush()
        task = Task(user_id=owner.id, title="할 일")
        db.add_all([task, Deadline(user_id=owner.id, title="마감일", due_at=end)])
        db.flush()
        db.add_all([
            ScheduledEvent(user_id=owner.id, task_id=task.id, start_at=start, end_at=end, status="approved"),
            ScheduledEvent(user_id=owner.id, task_id=task.id, start_at=end,
                           end_at=end + timedelta(hours=1), status="cancelled"),
        ])
        db.flush()
        result = list_schedules(owner, db, Response(), limit=1)
        assert result["has_more"]
        item = result["entries"][0]["item"]
        assert item.id == task.id
        assert item.placement.model_dump() == {"start_at": start, "end_at": end, "block_count": 1}
