"""Migration and durable intent constraints in rollback-only PostgreSQL schemas."""

import os
import uuid
from datetime import UTC, datetime
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError

from app.models import Deadline, GoogleExport, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(
    os.environ.get("PLANCATCH_TEST_POSTGRES") != "1", reason="PostgreSQL opt-in"
)


def test_export_migration_preserves_deadlines_and_unique_send_intents(pg):
    schema = pg.get_execution_options()["schema_translate_map"][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    GoogleExport.__table__.drop(pg)
    owner, item, identity = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    pg.execute(
        insert(User).values(
            id=owner, email=f"{owner}@example.com", password_hash="test"
        )
    )
    due = datetime(2026, 11, 10, tzinfo=UTC)
    pg.execute(
        insert(Deadline).values(id=item, user_id=owner, title="Preserved", due_at=due)
    )
    migration = import_module("migrations.versions.20261026_0008_google_exports")
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    assert pg.scalar(select(Deadline.due_at).where(Deadline.id == item)) == due
    values = {
        "id": identity,
        "user_id": owner,
        "kind": "deadline",
        "item_id": item,
        "connection_binding": "a" * 64,
        "payload": {},
        "payload_hash": "b" * 64,
        "google_event_id": "pc" + identity.hex,
        "status": "pending",
    }
    pg.execute(insert(GoogleExport).values(**values))
    with pytest.raises(IntegrityError), pg.begin_nested():
        pg.execute(
            insert(GoogleExport).values(
                **{
                    **values,
                    "id": uuid.uuid4(),
                    "google_event_id": "pc" + uuid.uuid4().hex,
                }
            )
        )
    pg.execute(Deadline.__table__.delete().where(Deadline.id == item))
    assert (
        pg.scalar(select(GoogleExport.id).where(GoogleExport.id == identity))
        == identity
    )
