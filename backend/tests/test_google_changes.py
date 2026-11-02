"""Versioned provider fakes; no real Google account or API writes."""
import copy

import pytest

from app.services import google_events
from app.services import google_export as transport
from tests.test_auth import TestingSession
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_google_events import connected
from tests.test_google_exports import BASE, deadline, preview, send
from tests.test_google_exports import (
    manual_protocol as manual_protocol,  # noqa: PLC0414
)
from tests.test_sources import configure_test_jwt as configure_test_jwt  # noqa: PLC0414


@pytest.fixture
def changes(setup, monkeypatch):
    auth = connected(setup)
    monkeypatch.setattr(google_events, "refresh_access", lambda *_: ("synthetic-token", None))
    remote, calls, applied = {}, [], []
    failure = {"before": None, "after": None, "race": None}

    def request(token, method, identity, body=None, *, etag=None):
        assert token == "synthetic-token"
        calls.append(method)
        if method == "GET":
            return (200, copy.deepcopy(remote[identity])) if identity in remote else (404, {})
        if failure["before"] == method:
            failure["before"] = None
            raise transport.ExportError()
        if failure["race"] == method:
            remote[identity]["etag"] = '"concurrent"'
            failure["race"] = None
        if method != "POST" and etag != remote[identity]["etag"]:
            raise transport.ExportError(409, "conflict")
        if method == "POST":
            remote[identity] = {**copy.deepcopy(body), "status": "confirmed", "etag": '"1"'}
        elif method == "PATCH":
            remote[identity].update(copy.deepcopy(body))
            remote[identity]["etag"] = '"2"'
        else:
            assert method == "DELETE" and body is None
            remote.pop(identity)
        applied.append(method)
        if failure["after"] == method:
            failure["after"] = None
            raise transport.ExportError()
        return (204, {}) if method == "DELETE" else (200, copy.deepcopy(remote[identity]))

    monkeypatch.setattr(transport, "request", request)
    target = deadline(setup, auth)
    failure["initial_view"] = preview(setup, auth, target)
    first = send(setup, auth, target, failure["initial_view"])
    assert first.status_code == 200
    return auth, target, first.json()["google_event_id"], remote, calls, applied, failure


def view(setup, auth, target, action):
    return setup.client.post(BASE + "/change-preview", headers=auth, json={**target, "action": action})


def confirm(setup, auth, target, action, result):
    return setup.client.post(BASE + "/change-confirm", headers=auth,
                             json={**target, "action": action, "preview_token": result["preview_token"], "confirm": True})


def edit(setup, auth, target, title="새 마감일"):
    result = setup.client.patch('/api/deadlines/' + target['item_id'], headers=auth,
                               json={'title': title, 'due_at': '2026-11-12T18:30:00+09:00'})
    assert result.status_code == 200


def test_update_preview_is_read_only_and_patch_preserves_unmanaged_fields(setup, changes):
    auth, target, identity, remote, calls, applied, _ = changes
    remote[identity].update(description="사용자가 Google에서 추가한 메모", reminders={"useDefault": True})
    edit(setup, auth, target)
    result = view(setup, auth, target, "update")
    assert result.status_code == 200
    proposal = result.json()
    assert proposal['before']['title'] == '지원 마감' and proposal['after']['title'] == '새 마감일'
    assert applied == ['POST'] and 'PATCH' not in calls
    assert confirm(setup, auth, target, 'update', proposal).status_code == 200
    assert confirm(setup, auth, target, 'update', proposal).json()['already_applied']
    assert remote[identity]['summary'] == '새 마감일'
    assert remote[identity]['description'].endswith('추가한 메모') and remote[identity]['reminders']['useDefault']
    assert applied == ['POST', 'PATCH']
    assert preview(setup, auth, target)['changed'] is False


def test_delete_copy_is_confirmed_idempotent_and_does_not_delete_local_data(setup, changes):
    auth, target, identity, remote, _, applied, failure = changes
    local = '/api/deadlines/' + target['item_id']
    assert setup.client.get(local, headers=auth).status_code == 200
    proposal = view(setup, auth, target, 'delete').json()
    assert identity in remote and applied == ['POST']
    assert confirm(setup, auth, target, 'delete', proposal).status_code == 200
    assert confirm(setup, auth, target, 'delete', proposal).json()['already_applied']
    assert identity not in remote and applied == ['POST', 'DELETE']
    assert setup.client.get(local, headers=auth).status_code == 200
    assert preview(setup, auth, target)['status'] == 'deleted'
    assert send(setup, auth, target, failure['initial_view']).status_code == 409
    assert setup.client.delete(local, headers=auth).status_code == 204


@pytest.mark.parametrize('action,method', [('update', 'PATCH'), ('delete', 'DELETE')])
@pytest.mark.parametrize('when', ['before', 'after'])
def test_uncertain_writes_recover_the_same_intent_without_repeating_applied_changes(setup, changes, action, method, when):
    auth, target, _, _, _, applied, failure = changes
    if action == 'update':
        edit(setup, auth, target)
    proposal = view(setup, auth, target, action).json()
    failure[when] = method
    assert confirm(setup, auth, target, action, proposal).status_code == 502
    assert preview(setup, auth, target)['status'] == 'changing'
    assert setup.client.get('/api/deadlines/' + target['item_id'], headers=auth).status_code == 200
    retry = view(setup, auth, target, action).json()
    assert retry['state'] == 'pending'
    assert confirm(setup, auth, target, action, retry).status_code == 200
    assert applied.count(method) == 1


@pytest.mark.parametrize('action,method', [('update', 'PATCH'), ('delete', 'DELETE')])
def test_changed_etag_is_not_overwritten_or_deleted(setup, changes, action, method):
    auth, target, identity, remote, _, applied, failure = changes
    if action == 'update':
        edit(setup, auth, target)
    proposal = view(setup, auth, target, action).json()
    failure['race'] = method
    assert confirm(setup, auth, target, action, proposal).status_code == 409
    assert identity in remote and applied == ['POST']
    assert confirm(setup, auth, target, action, proposal).status_code == 409


@pytest.mark.parametrize('field,value', [('summary', 'Google에서 바꾼 제목'), ('attendees', [{'self': True}]),
                                         ('recurrence', ['RRULE:FREQ=DAILY']), ('eventType', 'focusTime'),
                                         ('extendedProperties', None), ('organizer', 'invalid')])
def test_foreign_changes_meetings_and_recurring_events_are_not_modified(setup, changes, field, value):
    auth, target, identity, remote, _, applied, _ = changes
    remote[identity][field] = value
    edit(setup, auth, target)
    assert view(setup, auth, target, 'update').status_code == 409
    assert view(setup, auth, target, 'delete').status_code == 409
    assert applied == ['POST']


def test_stale_local_values_token_scope_expiry_and_owner_are_checked(setup, changes):
    auth, target, _, _, _, applied, _ = changes
    edit(setup, auth, target)
    result = view(setup, auth, target, 'update').json()
    edit(setup, auth, target, '두 번째 변경')
    assert confirm(setup, auth, target, 'update', result).status_code == 409
    assert confirm(setup, auth, target, 'delete', result).status_code == 409
    other = connected(setup)
    assert view(setup, other, target, 'delete').status_code == 409
    assert setup.client.post(BASE + '/change-preview', json={**target, 'action': 'delete'}).status_code == 401
    assert setup.client.post(BASE + '/change-confirm', headers=auth, json={**target, 'action': 'delete', 'preview_token': 'bad', 'confirm': True}).status_code == 409
    assert applied == ['POST']


def test_external_delete_can_be_acknowledged_and_no_copy_is_recreated(setup, changes):
    auth, target, identity, remote, _, applied, _ = changes
    remote.pop(identity)
    result = view(setup, auth, target, 'delete').json()
    assert confirm(setup, auth, target, 'delete', result).status_code == 200
    assert applied == ['POST'] and preview(setup, auth, target)['preview_token'] is None


def test_owned_history_survives_a_legacy_local_delete(setup, changes):
    auth, target, _, _, _, _, _ = changes
    from app.models import Deadline
    with TestingSession() as db:
        import uuid
        row = db.get(Deadline, uuid.UUID(target['item_id']))
        db.delete(row)
        db.commit()
    entries = setup.client.get(BASE, headers=auth).json()['entries']
    assert len(entries) == 1 and entries[0]['item_id'] == target['item_id']
    assert preview(setup, auth, target)['local_available'] is False
    assert confirm(setup, auth, target, 'delete', view(setup, auth, target, 'delete').json()).status_code == 200


@pytest.mark.parametrize('value', [False, 1, 'true'])
def test_non_boolean_confirmation_does_not_write(setup, changes, value):
    auth, target, _, _, _, applied, _ = changes
    proposal = view(setup, auth, target, 'delete').json()
    response = setup.client.post(BASE + '/change-confirm', headers=auth, json={
        **target, 'action': 'delete', 'preview_token': proposal['preview_token'], 'confirm': value,
    })
    assert response.status_code == 422 and applied == ['POST']


def test_expired_preview_and_changed_connection_never_write(setup, changes):
    import json
    from datetime import timedelta

    from app.models import GoogleCalendarConnection
    from app.services import google_calendar as google
    from tests.test_google_calendar import connection_user
    auth, target, _, _, _, applied, _ = changes
    proposal = view(setup, auth, target, 'delete').json()
    config, identity = google.configuration(), connection_user(auth)
    claims = json.loads(google.decrypt(config, identity, 'change-preview', proposal['preview_token']))
    expired = {**proposal, 'preview_token': google.encrypt(config, identity, 'change-preview', json.dumps({**claims, 'expires': 0}))}
    assert confirm(setup, auth, target, 'delete', expired).status_code == 409
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, identity)
        row.connected_at += timedelta(seconds=1)
        db.commit()
    assert confirm(setup, auth, target, 'delete', proposal).status_code == 409
    assert applied == ['POST']


def test_pending_confirmation_keeps_the_frozen_payload_and_rejects_other_previews(setup, changes):
    auth, target, identity, remote, _, applied, failure = changes
    edit(setup, auth, target, '확인한 변경')
    one = view(setup, auth, target, 'update').json()
    two = view(setup, auth, target, 'update').json()
    failure['before'] = 'PATCH'
    assert confirm(setup, auth, target, 'update', one).status_code == 502
    assert confirm(setup, auth, target, 'update', two).status_code == 409
    edit(setup, auth, target, '그 뒤에 작성한 변경')
    retry = view(setup, auth, target, 'update').json()
    assert retry['after']['title'] == '확인한 변경'
    assert confirm(setup, auth, target, 'update', retry).status_code == 200
    assert remote[identity]['summary'] == '확인한 변경' and applied.count('PATCH') == 1
    assert preview(setup, auth, target)['changed']


@pytest.mark.parametrize('action', ['update', 'delete'])
def test_transport_requires_an_if_match_version_and_handles_empty_delete(monkeypatch, action):
    import io
    import uuid
    from urllib.error import HTTPError
    method = 'PATCH' if action == 'update' else 'DELETE'
    class Reply:
        status = 204
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def read(self, _): return b''
    class Opener:
        def open(self, request, timeout):
            assert request.get_header('If-match') == '"v1"'
            assert request.method == method and 'sendUpdates=none' in request.full_url
            if method == 'DELETE':
                assert 'fields=' not in request.full_url
            if method == 'PATCH':
                raise HTTPError(request.full_url, 412, 'ignored', {}, io.BytesIO(b'NEVER-ECHO'))
            return Reply()
    monkeypatch.setattr(transport, 'build_opener', lambda *_: Opener())
    identity = 'pc' + uuid.uuid4().hex
    with pytest.raises(transport.ExportError):
        transport.request('synthetic', method, identity)
    if action == 'delete':
        assert transport.request('synthetic', method, identity, etag='"v1"') == (204, {})
    else:
        with pytest.raises(transport.ExportError) as error:
            transport.request('synthetic', method, identity, {}, etag='"v1"')
        assert error.value.code == 'conflict' and 'NEVER-ECHO' not in str(error.value)
