"""Repeat boundaries, ownership, and safe Google master changes."""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import Task
from app.services.natural_schedule import SEOUL, interpret
from app.services.recurrence import google_rule, occurrences, same_google_rule
from tests.test_auth import TestingSession
from tests.test_google_auto_sync import automatic as automatic  # noqa: PLC0414
from tests.test_google_auto_sync import setup as setup  # noqa: PLC0414
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def create(auth, **changes):
    return client.post('/api/tasks', headers=auth, json={
        'title': '반복 회의', 'schedule_type': 'fixed',
        'earliest_start': '2026-11-02T23:30:00+09:00',
        'latest_end': '2026-11-03T00:30:00+09:00',
        'recurrence': {'frequency': 'weekly', 'count': 3}, **changes,
    })


def test_owned_series_projects_instances_without_duplicate_rows_and_deletes_all():
    auth = auth_headers(uuid.uuid4().hex + '@example.com')
    other = auth_headers(uuid.uuid4().hex + '@example.com')
    result = create(auth)
    assert result.status_code == 201, result.text
    task = result.json()
    window = {'start_from': '2026-11-09T00:00:00+09:00', 'end_before': '2026-11-24T00:00:00+09:00'}
    def calendar(headers=auth):
        return client.get('/api/calendar/registrations', headers=headers, params=window).json()['entries']
    rows = calendar()
    assert [r['start_at'] for r in rows] == ['2026-11-09T14:30:00Z', '2026-11-16T14:30:00Z']
    assert all(r['id'] == task['id'] and r['is_recurring'] for r in rows)
    assert len(client.get('/api/tasks', headers=auth).json()) == 1
    assert calendar(other) == []
    assert client.patch('/api/tasks/'+task['id'], headers=other, json={'recurrence': None}).status_code == 404
    assert client.patch('/api/tasks/'+task['id'], headers=auth,
        json={'recurrence': {'frequency':'daily','until':'2026-11-10'}}).status_code == 200
    assert len(calendar()) == 3  # Nov 8 overlaps the midnight boundary, plus Nov 9 and 10.
    assert client.delete('/api/tasks/'+task['id'], headers=auth).status_code == 204
    assert calendar() == []
    with TestingSession() as db:
        assert db.scalar(select(Task).where(Task.id == uuid.UUID(task['id']))) is None


@pytest.mark.parametrize('changes', [
    {'recurrence': {'frequency':'hourly'}}, {'recurrence': {'frequency':'daily','interval':0}},
    {'recurrence': {'frequency':'daily','count':1001}}, {'recurrence': {'frequency':'daily','interval':True}},
    {'recurrence': {'frequency':'daily','count':3,'until':'2026-11-20'}},
    {'recurrence': {'frequency':'weekly','until':'2026-11-01'}}, {'schedule_type':'flexible'},
    {'earliest_start':None}, {'latest_end':None},
])
def test_invalid_repeat_rejected(changes):
    auth = auth_headers(uuid.uuid4().hex+'@example.com')
    assert create(auth, **changes).status_code == 422


def test_monthly_missing_dates_count_and_range_and_until_are_consistent():
    start = datetime(2026,1,31,23,30,tzinfo=SEOUL)
    end = start + timedelta(hours=1)
    rule = {'frequency':'monthly','count':3}
    rows = occurrences(start,end,rule,datetime(2026,2,1,tzinfo=SEOUL),datetime(2026,6,1,tzinfo=SEOUL))
    assert [s.astimezone(SEOUL).date().isoformat() for s,_ in rows] == ['2026-01-31','2026-03-31','2026-05-31']
    assert google_rule({'frequency':'daily','until':'2026-11-10'}) == ['RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261110T145959Z']
    far = occurrences(start,end,{'frequency':'daily','interval':2},datetime(2090,1,1,tzinfo=UTC),datetime(2090,1,4,tzinfo=UTC))
    assert len(far) <= 2


@pytest.mark.parametrize('text,frequency,interval,title', [
    ('매주 월요일 오후3시 회의','weekly',1,'회의'),
    ('매일 오후3시 운동','daily',1,'운동'),
    ('격주 금요일 오전10시부터 11시 면담','weekly',2,'면담'),
    ('매월 15일 오전9시 정산','monthly',1,'정산'),
])
def test_sentence_repeat_is_editable_task(text,frequency,interval,title):
    result = interpret(text, now=datetime(2026,11,10,12,tzinfo=SEOUL))
    assert result.kind == 'task' and result.title == title
    assert result.recurrence.frequency == frequency and result.recurrence.interval == interval
    assert result.start_at and result.end_at and result.start_at < result.end_at


def test_implicit_repeat_rolls_forward_with_afternoon_and_month_boundaries():
    now = datetime(2026,11,15,21,tzinfo=SEOUL)
    daily = interpret('매일 3시 회의',now=now)
    assert daily.start_at == datetime(2026,11,16,15,tzinfo=SEOUL)
    monthly = interpret('매월 15일 오후3시 정산',now=now)
    assert monthly.start_at == datetime(2026,12,15,15,tzinfo=SEOUL)


def test_google_repeat_one_master_update_retry_remove_repeat_and_delete(setup, automatic):
    auth, _, remote, writes, _, failure, rows, drain = automatic
    result = create(auth)
    assert result.status_code == 201
    task = result.json()
    path = '/api/tasks/'+task['id']
    drain()
    assert writes == ['POST'] and len(remote) == 1
    identity = rows()[0].google_event_id
    assert remote[identity]['recurrence'] == ['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3']
    failure['after'] = 'PATCH'
    assert client.patch(path, headers=auth,json={'recurrence':{'frequency':'monthly','until':'2027-03-02'}}).status_code == 200
    drain(force_retry=True)
    assert writes == ['POST','PATCH'] and len(remote) == 1
    assert 'MONTHLY' in remote[identity]['recurrence'][0]
    assert client.patch(path,headers=auth,json={'recurrence':None}).status_code == 200
    drain()
    assert remote[identity]['recurrence'] == []
    assert client.patch(path,headers=auth,json={'recurrence':{'frequency':'daily','count':2}}).status_code == 200
    drain()
    assert client.delete(path,headers=auth).status_code == 204
    drain()
    assert not remote and writes.count('DELETE') == 1 and writes.count('POST') == 1


def test_repeat_cannot_be_duplicated_as_placement_or_changed_to_flexible():
    auth = auth_headers(uuid.uuid4().hex+'@example.com')
    task = create(auth).json()
    assert client.post('/api/scheduled-events',headers=auth,json={'task_id':task['id'],
        'start_at':'2026-11-02T23:30:00+09:00','end_at':'2026-11-03T00:30:00+09:00','status':'approved'}).status_code == 409
    assert client.patch('/api/tasks/'+task['id'],headers=auth,json={'schedule_type':'flexible'}).status_code == 422


def test_google_instances_are_bound_to_owned_master_only_when_time_matches(setup, automatic, monkeypatch):
    from app.schemas.google_event import GoogleEventsPage, GoogleEventView
    from app.services import google_events
    auth, _, _, _, _, _, rows, drain = automatic
    task = create(auth).json()
    drain()
    master = rows()[0].google_event_id
    begin = datetime(2026,11,9,14,30,tzinfo=UTC)
    monkeypatch.setattr(google_events, 'list_primary', lambda *_: GoogleEventsPage(events=[
        GoogleEventView(id=master+'_one',recurring_event_id=master,title='반복 회의',
            start_at=begin,end_at=begin+timedelta(hours=1)),
        GoogleEventView(id=master+'_changed',recurring_event_id=master,title='반복 회의',
            start_at=begin+timedelta(minutes=5),end_at=begin+timedelta(hours=1,minutes=5)),
    ]))
    result = setup.client.get('/api/integrations/google-calendar/events',headers=auth,
        params={'start_from':'2026-11-09T00:00:00Z','end_before':'2026-11-10T00:00:00Z'})
    assert result.status_code == 200
    events = result.json()['events']
    assert events[0]['local_item_id'] == task['id']
    assert events[1]['local_item_id'] is None
    assert same_google_rule(['RRULE:COUNT=3;FREQ=WEEKLY;WKST=MO'],google_rule({'frequency':'weekly','count':3}))
    assert not same_google_rule(['RRULE:FREQ=WEEKLY;COUNT=4'],google_rule({'frequency':'weekly','count':3}))
