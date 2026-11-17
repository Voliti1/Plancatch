"""Proposal/edge migration and cascades in a rollback-only private schema."""
import os
import uuid
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text

from app.models import Deadline, Task, TaskDependency, TaskProposal, User
from tests.test_postgresql import pg as pg  # noqa: PLC0414

pytestmark = pytest.mark.skipif(os.environ.get('PLANCATCH_TEST_POSTGRES') != '1', reason='PostgreSQL opt-in')


def test_proposal_migration_preserves_tasks_and_prerequisite_delete_cascades_edges(pg):
    from datetime import UTC, datetime
    schema = pg.get_execution_options()['schema_translate_map'][None]
    pg.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    assert schema.startswith('plancatch_test_') and pg.scalar(text('SELECT current_schema()')) == schema
    migration = import_module('migrations.versions.20261117_0018_task_plans')
    with Operations.context(MigrationContext.configure(pg)):
        migration.downgrade()
    owner, due, a, b = [uuid.uuid4() for _ in range(4)]
    pg.execute(User.__table__.insert().values(id=owner,email=f'{owner}@example.com',password_hash='temporary-test'))
    pg.execute(Deadline.__table__.insert().values(id=due,user_id=owner,title='deadline',due_at=datetime(2027,1,1,tzinfo=UTC)))
    pg.execute(Task.__table__.insert(),[{'id':a,'user_id':owner,'title':'original'},{'id':b,'user_id':owner,'title':'second'}])
    with Operations.context(MigrationContext.configure(pg)):
        migration.upgrade()
    assert pg.scalar(select(Task.title).where(Task.id==a))=='original'
    pg.execute(TaskDependency.__table__.insert().values(task_id=b,predecessor_id=a,user_id=owner))
    pg.execute(TaskProposal.__table__.insert().values(id=uuid.uuid4(),user_id=owner,deadline_id=due,request_id=uuid.uuid4(),input_hash='0'*64,
        deadline_hash='0'*64,model='synthetic',status='approved',revision=1,candidates=[],warnings=[],approved_task_ids=[str(a),str(b)]))
    pg.execute(Task.__table__.delete().where(Task.id==a))
    assert pg.scalar(select(TaskDependency.task_id)) is None
    assert pg.scalar(select(TaskProposal.approved_task_ids))==[str(a),str(b)]
    pg.execute(User.__table__.delete().where(User.id==owner))
    assert pg.scalar(select(TaskProposal.id)) is None
