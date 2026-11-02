"""Add fields to existing exports without queuing historic Google writes."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, Table, inspect, select, text

from app.models import GoogleExport, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(os.environ.get('PLANCATCH_TEST_POSTGRES') != '1', reason='PostgreSQL opt-in')


def test_existing_exports_are_preserved_and_do_not_send_on_upgrade(pg):
    schema = pg.get_execution_options()['schema_translate_map'][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert schema.startswith('plancatch_test_') and pg.scalar(text('SELECT current_schema()')) == schema
    migration = import_module('migrations.versions.20261102_0010_google_auto_sync')
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()
    owner, identity = uuid.uuid4(), uuid.uuid4()
    pg.execute(User.__table__.insert().values(id=owner, email=f'{owner}@example.com', password_hash='synthetic-only'))
    legacy = Table('google_calendar_exports', MetaData(), schema=schema, autoload_with=pg, resolve_fks=False)
    pg.execute(legacy.insert().values(id=identity, user_id=owner, kind='deadline', item_id=uuid.uuid4(),
        connection_binding='a'*64, payload={'summary':'기존 일정'}, payload_hash='b'*64,
        google_event_id='pc'+identity.hex, status='sent', revision=2, mutation={'state':'applied'}))
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    row = pg.execute(select(GoogleExport.__table__).where(GoogleExport.id == identity)).mappings().one()
    assert row['payload']['summary'] == '기존 일정' and row['revision'] == 2
    assert row['mutation'] == {'state':'applied'} and row['sync_pending'] is False and row['sync_attempts'] == 0
    assert row['desired_payload'] is None and row['retry_at'] is None
    assert any(index['column_names'] == ['sync_pending'] for index in inspect(pg).get_indexes('google_calendar_exports', schema=schema))
