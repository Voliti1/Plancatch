"""Migration changes structure only inside a rollback-only private schema."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, Table, inspect, select, text

from app.models import User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark=pytest.mark.skipif(os.environ.get('PLANCATCH_TEST_POSTGRES')!='1',reason='PostgreSQL opt-in')


def test_reminder_migration_keeps_legacy_items_and_export_queue_untouched(pg):
    schema=pg.get_execution_options()['schema_translate_map'][None]
    assert schema.startswith('plancatch_test_')
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    migration=import_module('migrations.versions.20261102_0011_google_reminders')
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()
    owner=uuid.uuid4()
    pg.execute(User.__table__.insert().values(id=owner,email=f'{owner}@example.com',password_hash='synthetic-only'))
    for name in ('tasks','deadlines'):
        table=Table(name,MetaData(),schema=schema,autoload_with=pg,resolve_fks=False)
        values={"id":uuid.uuid4(),"user_id":owner,"title":'마이그레이션 기존 항목'}
        if name=='deadlines':values['due_at']='2026-11-10T23:59:00+09:00'
        pg.execute(table.insert().values(**values))
    exports=pg.scalar(text('SELECT count(*) FROM google_calendar_exports'))
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    for name in ('tasks','deadlines'):
        columns=inspect(pg).get_columns(name,schema=schema)
        new=next(c for c in columns if c['name']=='google_reminders')
        assert new['nullable'] and new['default'] is None
        table=Table(name,MetaData(),schema=schema,autoload_with=pg,resolve_fks=False)
        saved=pg.execute(select(table.c.title,table.c.google_reminders)).one()
        assert saved==('마이그레이션 기존 항목',None)
    assert pg.scalar(text('SELECT count(*) FROM google_calendar_exports'))==exports
