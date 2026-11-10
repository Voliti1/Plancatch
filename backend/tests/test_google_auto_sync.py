"""Automatic CRUD dispatch with fake Google; no personal account or API calls."""
import copy
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete, select

from app.models import GoogleCalendarConnection, GoogleExport, User
from app.services import google_events
from app.services import google_export as transport
from app.services import google_sync as sync
from tests.test_auth import TestingSession
from tests.test_google_calendar import connection_user, owner
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_google_events import connected
from tests.test_google_exports import deadline
from tests.test_sources import configure_test_jwt as configure_test_jwt  # noqa: PLC0414

BASE = '/api/integrations/google-calendar/auto-sync'


@pytest.fixture
def automatic(setup, monkeypatch):
    auth = connected(setup)
    user_id = connection_user(auth)
    remote, writes, calls = {}, [], []
    failure = {'before': None, 'after': None}
    monkeypatch.setattr(google_events, 'refresh_access', lambda *_: ('synthetic-auto', None))

    def request(token, method, identity, body=None, *, etag=None):
        assert token == 'synthetic-auto'
        calls.append(method)
        if method == 'GET':
            return (200, copy.deepcopy(remote[identity])) if identity in remote else (404, {})
        if failure['before'] == method:
            failure['before'] = None
            raise transport.ExportError()
        if method != 'POST' and etag != remote[identity]['etag']:
            raise transport.ExportError(409, 'conflict')
        if method == 'POST':
            assert identity not in remote
            remote[identity] = {**copy.deepcopy(body), 'status': 'confirmed', 'etag': '"1"'}
        elif method == 'PATCH':
            remote[identity].update(copy.deepcopy(body))
            remote[identity]['etag'] = '"' + str(int(remote[identity]['etag'].strip('"')) + 1) + '"'
        else:
            assert method == 'DELETE' and body is None
            del remote[identity]
        writes.append(method)
        if failure['after'] == method:
            failure['after'] = None
            raise transport.ExportError()
        return (204, {}) if method == 'DELETE' else (201 if method == 'POST' else 200, copy.deepcopy(remote[identity]))

    monkeypatch.setattr(transport, 'request', request)

    def rows():
        with TestingSession() as db:
            return list(db.scalars(select(GoogleExport).where(GoogleExport.user_id == user_id)))

    def drain(rounds=8, force_retry=False):
        for _ in range(rounds):
            for row in rows():
                if force_retry and row.sync_pending:
                    with TestingSession() as db:
                        db.get(GoogleExport, row.id).retry_at = sync.now() - timedelta(seconds=1)
                        db.commit()
                with TestingSession() as db:
                    sync.process_row(db, row.id)

    yield auth, user_id, remote, writes, calls, failure, rows, drain
    with TestingSession() as db:
        db.execute(delete(User).where(User.id == user_id))
        db.commit()


def state(setup, auth, target):
    response = setup.client.get(BASE, headers=auth, params=target)
    assert response.status_code == 200
    return response.json()


def task(setup, auth):
    response = setup.client.post('/api/tasks', headers=auth, json={
        'title': '회의', 'schedule_type': 'fixed', 'earliest_start': '2026-11-15T10:00:00+09:00',
        'latest_end': '2026-11-15T11:00:00+09:00'})
    assert response.status_code == 201
    return response.json()


def test_registration_update_and_delete_need_no_preview_or_confirm(setup, automatic):
    auth, _, remote, writes, calls, _, rows, drain = automatic
    target = deadline(setup, auth)
    assert writes == [] and len(rows()) == 1
    assert state(setup, auth, target)['state'] == 'pending'
    drain()
    assert writes == ['POST'] and state(setup, auth, target)['state'] == 'synced'
    identity = rows()[0].google_event_id
    alarm = copy.deepcopy(remote[identity]['reminders'])
    remote[identity].update(description='Google 메모')
    assert setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth,
        json={'title': '변경한 제목', 'due_at': '2026-11-12T18:00:00+09:00'}).status_code == 200
    drain()
    assert remote[identity]['summary'] == '변경한 제목' and writes == ['POST', 'PATCH']
    assert remote[identity]['description'] == 'Google 메모' and remote[identity]['reminders'] == alarm
    count = len(calls)
    setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth, json={'description': '로컬 메모'})
    drain()
    assert len(calls) == count  # No Google request for fields that are not mirrored.
    assert setup.client.delete('/api/deadlines/' + target['item_id'], headers=auth).status_code == 204
    drain()
    assert remote == {} and writes == ['POST', 'PATCH', 'DELETE']
    assert rows()[0].deleted_at and not rows()[0].sync_pending


def test_deleted_schedule_status_is_owned_paged_and_survives_retry(setup, automatic):
    auth, _, remote, writes, calls, _, rows, drain = automatic
    target = deadline(setup, auth)
    item = task(setup, auth)
    drain()
    listing = BASE + '/deletions'
    assert setup.client.get(listing, headers=auth).json()['entries'] == []
    assert setup.client.delete('/api/deadlines/' + target['item_id'], headers=auth).status_code == 204
    assert setup.client.delete('/api/tasks/' + item['id'], headers=auth).status_code == 204
    count = len(calls)
    result = setup.client.get(listing, headers=auth).json()
    assert len(result['entries']) == 2 and {e['state'] for e in result['entries']} == {'pending'}
    assert len(calls) == count  # Reading the queue never calls or changes Google.
    assert setup.client.get(listing).status_code == 401
    other = owner()
    try:
        assert setup.client.get(listing, headers=other).json()['entries'] == []
        assert setup.client.post(BASE, headers=other, json=target).status_code == 404
    finally:
        with TestingSession() as db:
            db.execute(delete(User).where(User.id == connection_user(other)))
            db.commit()
    assert setup.client.get(listing, headers=auth, params={'limit': 1}).json()['has_more']
    assert len(setup.client.get(listing, headers=auth, params={'limit': 1, 'offset': 1}).json()['entries']) == 1
    deadline_row = next(row for row in rows() if row.kind == 'deadline')
    original = copy.deepcopy(remote[deadline_row.google_event_id])
    remote[deadline_row.google_event_id]['summary'] = 'Google에서 바뀐 제목'
    drain()
    result = setup.client.get(listing, headers=auth).json()
    failed = next(e for e in result['entries'] if e['kind'] == 'deadline')
    assert failed['state'] == 'failed' and failed['retryable']
    assert '직접 바뀌었거나' in failed['note']
    assert next(e for e in result['entries'] if e['kind'] == 'task')['state'] == 'deleted'
    remote[deadline_row.google_event_id] = original
    assert setup.client.post(BASE, headers=auth, json=target).status_code == 202
    drain()
    assert remote == {} and writes.count('DELETE') == 2
    assert {e['state'] for e in setup.client.get(listing, headers=auth).json()['entries']} == {'deleted'}
    with TestingSession() as db:
        for row in rows():
            db.get(GoogleExport, row.id).deleted_at = sync.now() - timedelta(hours=25)
        db.commit()
    assert setup.client.get(listing, headers=auth).json()['entries'] == []
    with TestingSession() as db:
        db.get(GoogleExport, deadline_row.id).error_code = 'credentials_unavailable'
        db.commit()
    assert setup.client.get(listing, headers=auth).json()['entries'][0]['state'] == 'failed'


def test_create_then_delete_before_delivery_never_creates_a_google_copy(setup, automatic):
    auth, _, remote, writes, _, _, rows, drain = automatic
    target = deadline(setup, auth)
    assert setup.client.delete('/api/deadlines/' + target['item_id'], headers=auth).status_code == 204
    drain()
    assert writes == [] and remote == {} and rows()[0].deleted_at


@pytest.mark.parametrize('method', ['POST', 'PATCH', 'DELETE'])
@pytest.mark.parametrize('when', ['before', 'after'])
def test_lost_write_outcomes_resume_the_same_id_and_do_not_duplicate(setup, automatic, method, when):
    auth, _, _, writes, _, failure, rows, drain = automatic
    target = deadline(setup, auth)
    if method != 'POST':
        drain()
        if method == 'PATCH':
            setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth, json={'title': '새 제목'})
        else:
            setup.client.delete('/api/deadlines/' + target['item_id'], headers=auth)
    identity = rows()[0].google_event_id
    failure[when] = method
    drain()
    row = rows()[0]
    assert row.sync_pending and row.error_code == 'uncertain' and sync.utc(row.retry_at) > sync.now()
    drain(force_retry=True)
    assert writes.count(method) == 1 and rows()[0].google_event_id == identity
    assert not rows()[0].sync_pending


def test_newest_edit_is_coalesced_but_a_durable_in_flight_change_is_finished_first(setup, automatic):
    auth, _, remote, writes, _, _, rows, drain = automatic
    target = deadline(setup, auth)
    for title in ['첫 수정', '두 번째', '최종 제목']:
        assert setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth, json={'title': title}).status_code == 200
    drain()
    assert writes == ['POST', 'PATCH'] and next(iter(remote.values()))['summary'] == '최종 제목'
    setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth, json={'title': '확인된 수정'})
    drain(rounds=1)  # Commit the write intent, but do not send it yet.
    assert rows()[0].mutation['state'] == 'pending'
    setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth, json={'title': '나중 수정'})
    drain()
    assert next(iter(remote.values()))['summary'] == '나중 수정'
    assert writes == ['POST', 'PATCH', 'PATCH', 'PATCH']


@pytest.mark.parametrize('changed', ['summary', 'attendees'])
def test_google_conflicts_stop_automatic_overwrites(setup, automatic, changed):
    auth, _, remote, writes, _, _, _, drain = automatic
    target = deadline(setup, auth)
    drain()
    item = next(iter(remote.values()))
    item[changed] = 'Google에서 수정' if changed == 'summary' else [{'self': True}]
    setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth, json={'title': '로컬 변경'})
    drain()
    assert writes == ['POST'] and state(setup, auth, target)['state'] == 'failed'
    assert 'Google' in state(setup, auth, target)['note']


def test_retry_is_owned_bounded_and_works_after_transient_failure(setup, automatic):
    auth, _, _, writes, _, failure, rows, drain = automatic
    target = deadline(setup, auth)
    for _ in range(10):
        failure['before'] = 'POST'
        drain(rounds=1, force_retry=True)
    assert rows()[0].sync_attempts == 10 and not rows()[0].sync_pending
    assert state(setup, auth, target)['state'] == 'failed'
    assert setup.client.post(BASE, headers=owner(), json=target).status_code == 404
    assert setup.client.post(BASE, headers=auth, json=target).status_code == 202
    drain()
    assert writes == ['POST'] and state(setup, auth, target)['state'] == 'synced'


def test_disconnect_or_account_change_cannot_forward_old_intents(setup, automatic):
    auth, user_id, _, writes, calls, _, rows, drain = automatic
    target = deadline(setup, auth)
    with TestingSession() as db:
        db.get(GoogleCalendarConnection, user_id).connected_at += timedelta(seconds=1)
        db.commit()
    drain()
    assert not calls and not writes and rows()[0].error_code == 'connection_changed'
    assert not state(setup, auth, target)['retryable']


def test_fixed_task_placement_transition_and_cascade_deletion_keep_no_old_copies(setup, automatic):
    auth, _, remote, writes, _, _, _, drain = automatic
    item = task(setup, auth)
    drain()
    old_id = next(iter(remote))
    event = setup.client.post('/api/scheduled-events', headers=auth, json={'task_id': item['id'],
        'start_at': '2026-11-15T12:00:00+09:00', 'end_at': '2026-11-15T13:00:00+09:00', 'status': 'approved'})
    assert event.status_code == 201
    drain(force_retry=True)
    assert old_id not in remote and len(remote) == 1
    assert writes == ['POST', 'DELETE', 'POST']
    assert setup.client.delete('/api/scheduled-events/' + event.json()['id'], headers=auth).status_code == 204
    drain(force_retry=True)
    assert len(remote) == 1 and old_id not in remote
    assert setup.client.delete('/api/tasks/' + item['id'], headers=auth).status_code == 204
    drain()
    assert remote == {}


def test_flexible_and_unapproved_items_stay_local_and_failed_mutations_do_not_change_intents(setup, automatic):
    auth, _, remote, writes, _, _, rows, drain = automatic
    for kind, body in [('tasks', {'title':'유동 작업'}), ('deadlines', {'title':'미확인', 'due_at':'2026-11-10T18:00:00+09:00'})]:
        assert setup.client.post('/api/' + kind, headers=auth, json=body).status_code == 201
    assert rows() == []
    item = task(setup, auth)
    saved = copy.deepcopy(rows()[0].desired_payload)
    assert setup.client.patch('/api/tasks/' + item['id'], headers=auth,
        json={'latest_end':'2026-11-14T10:00:00+09:00'}).status_code == 422
    assert rows()[0].desired_payload == saved
    drain()
    assert len(remote) == 1 and writes == ['POST']


def test_unconnected_crud_and_status_need_no_google_or_outbound_calls(setup, monkeypatch):
    auth = owner()
    calls = []
    monkeypatch.setattr(transport, 'request', lambda *a, **kw: calls.append(True))
    target = deadline(setup, auth)
    assert state(setup, auth, target)['state'] == 'not_connected'
    assert setup.client.post(BASE, headers=auth, json=target).status_code == 409
    assert setup.client.get(BASE, params=target).status_code == 401
    assert setup.client.post(BASE, json=target).status_code == 401
    assert setup.client.get(BASE, headers=auth, params={**target, 'item_id':str(uuid.uuid4())}).status_code == 404
    assert setup.client.delete('/api/deadlines/' + target['item_id'], headers=auth).status_code == 204
    assert not calls


@pytest.mark.parametrize("use_email", [False, True])
def test_source_approval_queues_only_approved_deadlines_and_last_delete_cleans_source(setup, automatic, use_email):
    from app.models import Analysis, Source
    from app.services.ai_analysis import content_hash
    auth, user_id, remote, writes, _, _, rows, drain = automatic
    text = '접수 마감 2026.11.15 18:00'
    created = setup.client.post('/api/sources', headers=auth, json={'source_type':'text','original_text':text})
    source_id = created.json()['id']
    assert setup.client.post('/api/sources/' + source_id + '/analyze', headers=auth).status_code == 202
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        analysis = Analysis(user_id=user_id, source_id=source.id, input_text=source.extracted_text,
            input_hash=content_hash(source.extracted_text), model='synthetic-only', status='ready', revision=1,
            candidates=[{'id':str(uuid.uuid4()), 'title':'자료 마감', 'due_at':'2026-11-15T18:00:00+09:00',
                'description':None, 'confidence':1.0, 'evidence_text':text, 'selected':True}], warnings=[])
        db.add(analysis)
        db.commit()
        path = '/api/ai-analyses/' + str(analysis.id) + '/approve'
    assert rows() == []
    approval = {'revision': 1}
    if use_email:
        approval['google_reminders'] = {'mode': 'custom', 'overrides': [{'method': 'email', 'minutes': 15}]}
    approved = setup.client.post(path, headers=auth, json=approval)
    assert approved.status_code == 200 and len(rows()) == 1
    assert setup.client.post(path, headers=auth, json={'revision':1}).json()['approved_deadline_ids'] == approved.json()['approved_deadline_ids']
    drain()
    assert writes == ['POST'] and len(remote) == 1
    assert next(iter(remote.values()))['reminders'] == {
        'useDefault': False,
        'overrides': [{'method': 'email', 'minutes': 15}] if use_email else [],
    }
    assert setup.client.delete('/api/deadlines/' + approved.json()['approved_deadline_ids'][0], headers=auth).status_code == 204
    drain()
    assert remote == {} and setup.client.get('/api/sources/' + source_id, headers=auth).status_code == 404


def test_natural_language_registration_uses_the_same_automatic_delivery(setup, automatic):
    auth, _, remote, writes, _, _, _, drain = automatic
    draft = setup.client.post('/api/schedules/interpret', headers=auth, json={'text':'내일 오후3시부터 4시까지 회의'})
    assert draft.status_code == 200
    value = draft.json()
    assert value['kind'] == 'task'
    assert setup.client.post('/api/tasks', headers=auth, json={'title':value['title'], 'schedule_type':'fixed',
        'earliest_start':value['start_at'], 'latest_end':value['end_at']}).status_code == 201
    drain()
    assert len(remote) == 1 and writes == ['POST'] and next(iter(remote.values()))['summary'] == '회의'
