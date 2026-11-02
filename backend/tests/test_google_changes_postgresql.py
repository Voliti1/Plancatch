"""Additive migration backfill in a transaction-rolled-back private schema only."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, Table, select, text

from app.models import GoogleExport, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(os.environ.get("PLANCATCH_TEST_POSTGRES") != "1", reason="PostgreSQL opt-in")


def test_change_fields_backfill_existing_exports_without_replacing_rows(pg):
    schema = pg.get_execution_options()["schema_translate_map"][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert pg.scalar(text('SELECT current_schema()')) == schema and schema.startswith('plancatch_test_')
    owner, identity, item = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    pg.execute(User.__table__.insert().values(id=owner, email=f'{owner}@example.com', password_hash='synthetic-only'))
    with Operations.context(MigrationContext.configure(pg)):
        import_module('migrations.versions.20261102_0009_google_changes').downgrade()
    legacy = Table('google_calendar_exports', MetaData(), schema=schema, autoload_with=pg, resolve_fks=False)
    pg.execute(legacy.insert().values(id=identity, user_id=owner, kind='task', item_id=item,
                                      connection_binding='a' * 64, payload={'summary': '기존 전송'},
                                      payload_hash='b' * 64, google_event_id='pc' + identity.hex, status='sent'))
    with Operations.context(MigrationContext.configure(pg)):
        import_module('migrations.versions.20261102_0009_google_changes').upgrade()
    row = pg.execute(select(GoogleExport.__table__).where(GoogleExport.id == identity)).mappings().one()
    assert row['id'] == identity and row['payload']['summary'] == '기존 전송'
    assert row['revision'] == 1 and row['mutation'] is None and row['deleted_at'] is None
    assert pg.scalar(select(User.email).where(User.id == owner)) == f'{owner}@example.com'
