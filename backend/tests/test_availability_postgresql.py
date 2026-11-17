"""PostgreSQL migration proof in a rollback-only private schema."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, select, text

from app.models import AvailabilityProfile, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(os.environ.get("PLANCATCH_TEST_POSTGRES") != "1", reason="PostgreSQL opt-in")


def test_availability_upgrade_keeps_accounts_and_deleting_owner_cascades_profile(pg):
    schema = pg.get_execution_options()["schema_translate_map"][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert schema.startswith("plancatch_test_") and pg.scalar(text("SELECT current_schema()")) == schema
    migration = import_module("migrations.versions.20261117_0017_availability")
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()  # Disposable schema only; outer transaction rolls back.
    owner = uuid.uuid4()
    pg.execute(User.__table__.insert().values(id=owner, email=f"{owner}@example.com", password_hash="synthetic-only"))
    before = {c["name"]: str(c["type"]) for c in inspect(pg).get_columns("users", schema=schema)}
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    assert pg.scalar(select(User.id).where(User.id == owner)) == owner
    assert before == {c["name"]: str(c["type"]) for c in inspect(pg).get_columns("users", schema=schema)}
    pg.execute(AvailabilityProfile.__table__.insert().values(user_id=owner, revision=1, weekly=[], exceptions=[]))
    assert pg.scalar(select(AvailabilityProfile.revision).where(AvailabilityProfile.user_id == owner)) == 1
    pg.execute(User.__table__.delete().where(User.id == owner))
    assert pg.scalar(select(AvailabilityProfile.user_id).where(AvailabilityProfile.user_id == owner)) is None
