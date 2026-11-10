"""Migration proof in a private rollback-only PostgreSQL schema."""

import os
import uuid
from datetime import UTC, datetime, timedelta
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, select, text

from app.models import SchedulePlan, Task, User
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
