"""An opt-in, transaction-rolled-back migration in an isolated test schema."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, Table, inspect, select, text

from app.models import Task, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(os.environ.get('PLANCATCH_TEST_POSTGRES') != '1', reason='PostgreSQL opt-in')


def test_existing_tasks_preserved_without_enqueuing_on_upgrade(pg):
    schema = pg.get_execution_options()['schema_translate_map'][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert schema.startswith('plancatch_test_') and pg.scalar(text('SELECT current_schema()')) == schema
    migration = import_module('migrations.versions.20261110_0013_task_recurrence')
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()  # Only the fixture's private schema; outer transaction rolls back.
    owner, identity = uuid.uuid4(), uuid.uuid4()
    pg.execute(User.__table__.insert().values(id=owner,email=f'{owner}@example.com',password_hash='synthetic-only'))
    legacy = Table('tasks',MetaData(),schema=schema,autoload_with=pg,resolve_fks=False)
    pg.execute(legacy.insert().values(id=identity,user_id=owner,title='기존 할 일',schedule_type='flexible',priority=3))
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    row = pg.execute(select(Task.__table__).where(Task.id==identity)).mappings().one()
    assert row['title']=='기존 할 일' and row['recurrence'] is None and row['schedule_type']=='flexible'
    assert next(col for col in inspect(pg).get_columns('tasks',schema=schema) if col['name']=='recurrence')['nullable']
