"""Opt-in PostgreSQL model tests in a transaction-scoped temporary schema.

Run on EC2 from backend with PLANCATCH_TEST_POSTGRES=1. Uses existing DB settings.
All schema/data changes are rolled back, including after assertion failures.
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, insert, select, text
from sqlalchemy.exc import IntegrityError

from app.db.base import Base
from app.db.session import build_database_url
from app.models import Analysis, Deadline, ScheduledEvent, Source, Task, User

pytestmark = pytest.mark.skipif(
    os.environ.get("PLANCATCH_TEST_POSTGRES") != "1",
    reason="Requires explicit PostgreSQL test opt-in and configured DB connection",
)


@pytest.fixture
def pg():
    from sqlalchemy import create_engine

    engine = create_engine(build_database_url(), connect_args={"connect_timeout": 10})
    schema = f"plancatch_test_{uuid.uuid4().hex}"
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                connection = connection.execution_options(schema_translate_map={None: schema})
                Base.metadata.create_all(connection)
                yield connection
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


def test_postgresql_constraints_timezone_and_cascades(pg):
    user_id, source_id, deadline_id, task_id, event_id = [uuid.uuid4() for _ in range(5)]
    due = datetime(2026, 9, 30, 18, tzinfo=UTC)
    pg.execute(insert(User).values(
        id=user_id, email=f"{user_id}@example.com", password_hash="test-only",
    ))
    pg.execute(insert(Source).values(
        id=source_id, user_id=user_id, source_type="text", original_text="test",
    ))
    pg.execute(insert(Deadline).values(
        id=deadline_id, user_id=user_id, source_id=source_id, title="Due", due_at=due,
    ))
    pg.execute(insert(Task).values(id=task_id, user_id=user_id, deadline_id=deadline_id, title="Task"))
    pg.execute(insert(ScheduledEvent).values(
        id=event_id, user_id=user_id, task_id=task_id, start_at=due - timedelta(hours=1), end_at=due,
    ))
    saved = pg.scalar(select(Deadline.due_at).where(Deadline.id == deadline_id))
    assert saved.tzinfo is not None
    assert saved == due

    # SAVEPOINTs recover from deliberate constraint violations without losing the outer transaction.
    for values in ({"priority": 0}, {"estimated_minutes": -1}, {"deadline_id": uuid.uuid4()}):
        with pytest.raises(IntegrityError), pg.begin_nested():
            pg.execute(insert(Task).values(user_id=user_id, title="Invalid", **values))
    with pytest.raises(IntegrityError), pg.begin_nested():
        pg.execute(insert(ScheduledEvent).values(
            user_id=user_id, task_id=task_id, start_at=due, end_at=due,
        ))
    pg.execute(delete(Source).where(Source.id == source_id))
    assert pg.scalar(select(Deadline.source_id).where(Deadline.id == deadline_id)) is None
    pg.execute(delete(Deadline).where(Deadline.id == deadline_id))
    assert pg.scalar(select(Task.deadline_id).where(Task.id == task_id)) is None
    pg.execute(delete(Task).where(Task.id == task_id))
    assert pg.scalar(select(ScheduledEvent.id).where(ScheduledEvent.id == event_id)) is None


def test_postgresql_analysis_active_uniqueness_and_cascade(pg):
    user_id, source_id = uuid.uuid4(), uuid.uuid4()
    pg.execute(insert(User).values(id=user_id, email=f"{user_id}@example.com", password_hash="test"))
    pg.execute(insert(Source).values(id=source_id, user_id=user_id, source_type="text", original_text="test"))
    values = {"user_id": user_id, "source_id": source_id, "input_text": "test",
              "input_hash": "0" * 64, "model": "test-model", "status": "processing"}
    pg.execute(insert(Analysis).values(**values))
    with pytest.raises(IntegrityError), pg.begin_nested():
        pg.execute(insert(Analysis).values(**values))
    pg.execute(insert(Analysis).values(**dict(values, status="ready")))
    with pytest.raises(IntegrityError), pg.begin_nested():
        pg.execute(insert(Analysis).values(**dict(values, status="unknown")))
    pg.execute(delete(Source).where(Source.id == source_id))
    assert pg.scalar(select(Analysis.id).where(Analysis.source_id == source_id)) is None


def test_postgresql_analysis_migration_in_isolated_schema(pg):
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect

    schema = pg.get_execution_options()["schema_translate_map"][None]
    Analysis.__table__.drop(pg)
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    migration = import_module("migrations.versions.20260930_0005_ai_analyses")
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    indexes = inspect(pg).get_indexes("analyses", schema=schema)
    assert any(item["name"] == "uq_analyses_active_source" and item["unique"] for item in indexes)
    assert pg.scalar(select(Analysis.id)) is None


def test_postgresql_safety_buffer_migration_preserves_existing_dates(pg):
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect, update

    schema = pg.get_execution_options()["schema_translate_map"][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    # Recreate the previous structure only inside this rollback-only test schema.
    pg.execute(text('ALTER TABLE deadlines DROP CONSTRAINT ck_deadlines_safety_buffer_minutes'))
    pg.execute(text('ALTER TABLE deadlines DROP COLUMN safety_buffer_minutes'))
    user_id, deadline_id = uuid.uuid4(), uuid.uuid4()
    due = datetime(2026, 10, 5, 9, tzinfo=UTC)
    pg.execute(insert(User).values(id=user_id, email=f"{user_id}@example.com", password_hash="test"))
    pg.execute(insert(Deadline).values(id=deadline_id, user_id=user_id, title="Legacy", due_at=due))
    migration = import_module("migrations.versions.20260930_0006_safe_deadlines")
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    columns = inspect(pg).get_columns("deadlines", schema=schema)
    assert any(c["name"] == "safety_buffer_minutes" and c["nullable"] for c in columns)
    saved = pg.execute(select(Deadline.due_at, Deadline.safety_buffer_minutes)).one()
    assert saved == (due, None)
    for minutes in (0, -1):
        with pytest.raises(IntegrityError), pg.begin_nested():
            pg.execute(update(Deadline).values(safety_buffer_minutes=minutes))
    pg.execute(update(Deadline).values(safety_buffer_minutes=180))
    assert pg.execute(select(Deadline.due_at, Deadline.safety_buffer_minutes)).one() == (due, 180)
