"""Opt-in schema-only migration proof in a disposable, rolled-back PostgreSQL schema."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, Table, inspect, select, text

from app.models import Task, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark=pytest.mark.skipif(os.environ.get('PLANCATCH_TEST_POSTGRES')!='1',reason='PostgreSQL opt-in')


def test_additive_occurrence_columns_preserve_existing_tasks(pg):
    schema=pg.get_execution_options()['schema_translate_map'][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert schema.startswith('plancatch_test_') and pg.scalar(text('SELECT current_schema()'))==schema
    migration=import_module('migrations.versions.20261110_0014_task_occurrences')
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()  # Private schema only. The enclosing transaction rolls everything back.
    owner,identity=uuid.uuid4(),uuid.uuid4()
    pg.execute(User.__table__.insert().values(id=owner,email=f'{owner}@example.com',password_hash='synthetic-only'))
    legacy=Table('tasks',MetaData(),schema=schema,autoload_with=pg,resolve_fks=False)
    pg.execute(legacy.insert().values(id=identity,user_id=owner,title='기존 반복 일정',schedule_type='fixed',priority=3,
        recurrence={'frequency':'daily','count':3}))
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    row=pg.execute(select(Task.__table__).where(Task.id==identity)).mappings().one()
    assert row['title']=='기존 반복 일정' and row['recurrence']=={'frequency':'daily','count':3}
    assert all(row[key] is None for key in ['series_id','original_start','excluded_starts'])
    columns={col['name']:col for col in inspect(pg).get_columns('tasks',schema=schema)}
    assert all(columns[key]['nullable'] for key in ['series_id','original_start','excluded_starts'])
