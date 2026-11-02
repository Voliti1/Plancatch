"""Opt-in rollback-only PostgreSQL checks; never migrate the public schema."""

import os
import uuid
from datetime import UTC, datetime, timedelta
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import delete, insert, select, text
from sqlalchemy.exc import IntegrityError

from app.models import Deadline, GoogleCalendarConnection, GoogleOAuthRequest, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414 -- pytest fixture re-export

pytestmark = pytest.mark.skipif(
    os.environ.get("PLANCATCH_TEST_POSTGRES") != "1",
    reason="Requires explicit PostgreSQL opt-in and configured DB connection",
)


def test_google_connection_migration_preserves_planning_rows(pg):
    schema = pg.get_execution_options()["schema_translate_map"][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    GoogleOAuthRequest.__table__.drop(pg)
    GoogleCalendarConnection.__table__.drop(pg)
    user_id, deadline_id = uuid.uuid4(), uuid.uuid4()
    due = datetime(2026, 11, 10, 9, tzinfo=UTC)
    pg.execute(
        insert(User).values(
            id=user_id, email=f"{user_id}@example.com", password_hash="test"
        )
    )
    pg.execute(
        insert(Deadline).values(
            id=deadline_id, user_id=user_id, title="Preserved", due_at=due
        )
    )
    migration = import_module(
        "migrations.versions.20261020_0007_google_calendar_connections"
    )
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    assert pg.scalar(select(Deadline.due_at).where(Deadline.id == deadline_id)) == due
    assert pg.scalar(select(GoogleCalendarConnection.user_id)) is None
    assert pg.scalar(select(GoogleOAuthRequest.state_hash)) is None


def test_google_connection_constraints_and_user_cascade(pg):
    user_id = uuid.uuid4()
    now = datetime.now(UTC)
    pg.execute(
        insert(User).values(
            id=user_id, email=f"{user_id}@example.com", password_hash="test"
        )
    )
    pg.execute(
        insert(GoogleCalendarConnection).values(
            user_id=user_id,
            refresh_token_ciphertext="test-ciphertext",
            scopes="test",
            connected_at=now,
        )
    )
    pg.execute(
        insert(GoogleOAuthRequest).values(
            state_hash="0" * 64,
            user_id=user_id,
            browser_hash="1" * 64,
            verifier_ciphertext="test-ciphertext",
            expires_at=now + timedelta(minutes=10),
            consumed=False,
        )
    )
    with pytest.raises(IntegrityError), pg.begin_nested():
        pg.execute(
            insert(GoogleOAuthRequest).values(
                state_hash="2" * 64,
                user_id=user_id,
                browser_hash="3" * 64,
                verifier_ciphertext="test-ciphertext",
                expires_at=now,
                consumed=False,
            )
        )
    pg.execute(delete(User).where(User.id == user_id))
    assert pg.scalar(select(GoogleCalendarConnection.user_id)) is None
    assert pg.scalar(select(GoogleOAuthRequest.state_hash)) is None
