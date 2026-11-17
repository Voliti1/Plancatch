"""Regression proofs for prerequisite validity, bounded lookup cost and extreme dates."""
import uuid

import pytest
from sqlalchemy import select

from app.models import Task
from app.schemas.task_plan import DependencyEdit
from app.services import task_dependencies
from tests.test_auth import TestingSession
from tests.test_auto_schedule import (  # noqa: F401
    approve,
    clock,
    events,
    owner,
    preview,
    task,
)
from tests.test_google_auto_sync import automatic, setup  # noqa: F401
from tests.test_reliability_efficiency import statements
from tests.test_sources import client, configure_test_jwt  # noqa: F401


def linked(auth, child, parents):
    path = f"/api/tasks/{child['id']}/dependencies"
    current = client.get(path, headers=auth).json()
    response = client.put(path, headers=auth, json={"revision": current['revision'],
        "predecessor_ids": [p['id'] for p in parents]})
    assert response.status_code == 200, response.text


def placed(auth, parent):
    response = client.post('/api/scheduled-events', headers=auth, json={
        'task_id': parent['id'], 'status': 'approved',
        'start_at': '2026-11-16T09:00:00+09:00', 'end_at': '2026-11-16T10:00:00+09:00'})
    assert response.status_code == 201, response.text


@pytest.mark.parametrize('kind', ['earliest_start', 'latest_end', 'official_deadline', 'safe_deadline'])
def test_out_of_window_prerequisite_is_not_accepted_as_ready(kind):
    auth = owner()
    extra = {}
    if kind in {'official_deadline', 'safe_deadline'}:
        data = {'title': '선행 작업 기한', 'due_at': '2026-11-16T08:00:00+09:00'}
        if kind == 'safe_deadline':
            data.update(due_at='2026-11-17T09:00:00+09:00', safety_buffer_minutes=1500)
        due = client.post('/api/deadlines', headers=auth, json=data)
        assert due.status_code == 201
        extra['deadline_id'] = due.json()['id']
    else:
        extra[kind] = '2026-11-16T11:00:00+09:00' if kind == 'earliest_start' else '2026-11-16T08:00:00+09:00'
    parent = task(auth, estimated_minutes=60, **extra)
    child = task(auth, estimated_minutes=60)
    placed(auth, parent)
    linked(auth, child, [parent])
    before = events(auth)
    response = preview(auth, [child], include_google=False)
    assert response.status_code == 201, response.text
    assert response.json()['blocks'] == []
    assert response.json()['details']['unplaced']
    assert events(auth) == before


def test_predecessor_deadline_change_invalidates_child_approval_without_partial_write():
    auth = owner()
    due = client.post('/api/deadlines', headers=auth, json={
        'title': '선행 기한', 'due_at': '2026-11-17T18:00:00+09:00'}).json()
    parent = task(auth, estimated_minutes=60, deadline_id=due['id'])
    child = task(auth, estimated_minutes=60)
    placed(auth, parent)
    linked(auth, child, [parent])
    plan = preview(auth, [child], include_google=False).json()
    assert plan['blocks']
    before = events(auth)
    changed = client.patch('/api/deadlines/' + due['id'], headers=auth,
        json={'due_at': '2026-11-16T08:00:00+09:00'})
    assert changed.status_code == 200
    assert approve(auth, plan).status_code == 409
    assert events(auth) == before


def test_twenty_parent_validation_uses_bounded_queries_without_large_text():
    auth = owner()
    child = task(auth, description='LARGE_UNUSED' * 1000)
    parents = [task(auth, description='LARGE_UNUSED' * 1000) for _ in range(20)]
    revision = client.get(f"/api/tasks/{child['id']}/dependencies", headers=auth).json()['revision']
    payload = DependencyEdit(revision=revision, predecessor_ids=[p['id'] for p in parents])
    with TestingSession() as db:
        identity = uuid.UUID(child['id'])
        user = db.scalar(select(Task.user_id).where(Task.id == identity))
        with statements() as reads:
            result = task_dependencies.replace(db, user, identity, payload)
        assert set(result['predecessor_ids']) == {uuid.UUID(p['id']) for p in parents}
        assert len(reads) <= 6
        assert not any('tasks.description' in sql for sql in reads)


def test_batch_parent_lookup_preserves_ownership_type_and_cycle_checks():
    auth = owner()
    child, parent = task(auth), task(auth)
    foreign = task(owner())
    fixed = task(auth, schedule_type='fixed', earliest_start='2026-11-16T09:00:00+09:00',
        latest_end='2026-11-16T10:00:00+09:00')
    path = f"/api/tasks/{child['id']}/dependencies"
    current = client.get(path, headers=auth).json()
    for identities, status in [([parent['id'], foreign['id']], 404),
                               ([parent['id'], fixed['id']], 422), ([child['id']], 422)]:
        assert client.put(path, headers=auth, json={
            'revision': current['revision'], 'predecessor_ids': identities}).status_code == status
        assert client.get(path, headers=auth).json() == current
    linked(auth, child, [parent])
    reverse = f"/api/tasks/{parent['id']}/dependencies"
    current = client.get(reverse, headers=auth).json()
    assert client.put(reverse, headers=auth, json={
        'revision': current['revision'], 'predecessor_ids': [child['id']]}).status_code == 422


def test_dependency_context_does_not_load_unused_task_or_sync_bodies():
    auth = owner()
    due = client.post('/api/deadlines', headers=auth, json={
        'title': '선행 기한', 'description': 'LARGE_UNUSED' * 1000,
        'due_at': '2026-11-17T18:00:00+09:00'}).json()
    parent = task(auth, estimated_minutes=60, deadline_id=due['id'], description='LARGE_UNUSED' * 1000)
    child = task(auth, estimated_minutes=60)
    placed(auth, parent)
    linked(auth, child, [parent])
    with TestingSession() as db:
        selected = db.get(Task, uuid.UUID(child['id']))
        with statements() as reads:
            _, finishes, state = task_dependencies.context(db, selected.user_id, [selected])
        assert uuid.UUID(parent['id']) in finishes and state['deadlines']
        assert len(reads) <= 4
        assert not any('tasks.description' in sql or 'scheduled_events.sync_error' in sql or
            'deadlines.description' in sql for sql in reads)


def test_repaired_prerequisite_window_releases_the_child():
    auth = owner()
    parent = task(auth, estimated_minutes=60, latest_end='2026-11-16T08:00:00+09:00')
    child = task(auth, estimated_minutes=60)
    placed(auth, parent)
    linked(auth, child, [parent])
    assert preview(auth, [child], include_google=False).json()['blocks'] == []
    assert client.patch('/api/tasks/' + parent['id'], headers=auth,
        json={'latest_end': '2026-11-16T11:00:00+09:00'}).status_code == 200
    plan = preview(auth, [child], include_google=False).json()
    assert plan['blocks'] and approve(auth, plan).status_code == 200


def test_last_representable_long_occurrence_still_reads_normally():
    auth = owner()
    master = task(auth, schedule_type='fixed', earliest_start='2026-11-01T09:00:00+09:00',
        latest_end='2026-12-01T10:00:00+09:00', recurrence={'frequency': 'daily'})
    result = client.get('/api/tasks/' + master['id'] + '/occurrences', headers=auth,
        params={'original_start': '9999-11-29T09:00:00+09:00'})
    assert result.status_code == 200
    assert result.json()['latest_end'] == '9999-12-29T01:00:00Z'


@pytest.mark.parametrize('method', ['get', 'patch', 'delete'])
def test_extreme_occurrence_finish_returns_validation_error_without_changes(method):
    auth = owner()
    master = task(auth, schedule_type='fixed', earliest_start='2026-11-01T09:00:00+09:00',
        latest_end='2026-12-01T10:00:00+09:00', recurrence={'frequency': 'daily'})
    before = client.get('/api/tasks/' + master['id'], headers=auth).json()
    kwargs = {'headers': auth, 'params': {'original_start': '9999-12-31T09:00:00+09:00'}}
    if method == 'patch':
        kwargs['json'] = {'title': '유지해야 할 원본'}
    response = getattr(client, method)('/api/tasks/' + master['id'] + '/occurrences', **kwargs)
    assert response.status_code == 422
    assert client.get('/api/tasks/' + master['id'], headers=auth).json() == before
