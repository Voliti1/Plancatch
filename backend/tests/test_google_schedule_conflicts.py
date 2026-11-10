"""Google overlap reads use synthetic provider responses, never personal accounts."""
import copy
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.models import GoogleCalendarConnection, Task
from app.services import google_calendar as google
from app.services import google_events as events
from tests.test_auth import TestingSession
from tests.test_google_auto_sync import automatic as automatic  # noqa: PLC0414
from tests.test_google_calendar import connection_user
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_google_events import connected
from tests.test_schedule_conflicts import fixed_clock as fixed_clock  # noqa: PLC0414
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

BASE='/api/schedules/conflicts'
DRAFT={'start_at':'2026-11-16T15:00:00+09:00','end_at':'2026-11-16T16:00:00+09:00'}


def timed(identity, **extra):
    return {'id':identity,'summary':'구글 회의','start':{'dateTime':DRAFT['start_at']},
        'end':{'dateTime':DRAFT['end_at']},**extra}


def check(auth, **extra):
    return client.post(BASE,headers=auth,json={**DRAFT,**extra})


def provider(monkeypatch, payload):
    calls=[]
    monkeypatch.setattr(events,'refresh_access',lambda *_: ('synthetic-access',None))
    monkeypatch.setattr(events,'_fetch',lambda token,start,end,*_: calls.append((token,start,end)) or copy.deepcopy(payload))
    return calls


def test_busy_timed_all_day_repeated_and_boundaries_without_private_fields(setup,monkeypatch):
    auth=connected(setup)
    calls=provider(monkeypatch,{'items':[
        timed('busy'),timed('free',transparency='transparent'),
        timed('declined',attendees=[{'self':True,'responseStatus':'declined','email':'NEVER-ECHO'}]),
        timed('cancelled',status='cancelled'),timed('repeat',recurringEventId='provider-master'),
        timed('adjacent',start={'dateTime':'2026-11-16T16:00:00+09:00'},end={'dateTime':'2026-11-16T17:00:00+09:00'}),
        {'id':'allday','summary':'휴가','start':{'date':'2026-11-16'},'end':{'date':'2026-11-17'}},
    ]})
    with TestingSession() as db:
        before=db.scalar(select(func.count()).select_from(Task))
    response=check(auth)
    assert response.status_code==200,response.text
    data=response.json()
    assert data['google_state']=='checked' and data['scope']=='local_and_google_primary'
    assert {row['id'] for row in data['conflicts']}=={'busy','repeat','allday'}
    assert all(row['kind']=='google' and row['task_id'] is None for row in data['conflicts'])
    day=next(row for row in data['conflicts'] if row['id']=='allday')
    assert datetime.fromisoformat(day['start_at'])==datetime(2026,11,15,15,tzinfo=UTC)
    assert datetime.fromisoformat(day['end_at'])==datetime(2026,11,16,15,tzinfo=UTC) and day['is_all_day']
    assert len(calls)==1 and 'NEVER-ECHO' not in response.text and 'synthetic-access' not in response.text
    with TestingSession() as db:
        assert db.scalar(select(func.count()).select_from(Task))==before
    other=auth_headers(uuid.uuid4().hex+'@example.com')
    assert check(other).json()['google_state']=='not_connected' and len(calls)==1


def test_owned_copies_are_skipped_but_other_matching_titles_or_changed_copies_are_not(setup,automatic,monkeypatch):
    auth,_,remote,_,_,_,exports,drain=automatic
    task=client.post('/api/tasks',headers=auth,json={'title':'구글 회의','schedule_type':'fixed',
        'earliest_start':DRAFT['start_at'],'latest_end':DRAFT['end_at']}).json()
    drain()
    copy_id=exports()[0].google_event_id
    payload={'items':[copy.deepcopy(remote[copy_id]),timed('unrelated-same-title')]}
    provider(monkeypatch,payload)
    result=check(auth,exclude_task_id=task['id']).json()
    assert [row['id'] for row in result['conflicts']]==['unrelated-same-title']
    payload['items'][0]['summary']='구글에서 바꾼 제목'
    result=check(auth,exclude_task_id=task['id']).json()
    assert {row['id'] for row in result['conflicts']}=={copy_id,'unrelated-same-title'}


def test_unfinished_pages_and_unreadable_events_remain_incomplete_even_with_no_matches(setup,monkeypatch):
    auth=connected(setup)
    provider(monkeypatch,{'items':[],'nextPageToken':'NEVER-ECHO'})
    result=check(auth).json()
    assert result['google_state']=='partial' and not result['conflicts'] and result['google_message']
    provider(monkeypatch,{'items':[{'id':'bad','start':{},'end':{}}]})
    result=check(auth).json()
    assert result['google_state']=='partial' and not result['conflicts']


def test_refresh_or_read_failure_preserves_local_conflicts_and_rotated_credentials(setup,monkeypatch):
    auth=connected(setup)
    task=client.post('/api/tasks',headers=auth,json={'title':'로컬 회의','schedule_type':'fixed',
        'earliest_start':DRAFT['start_at'],'latest_end':DRAFT['end_at']}).json()
    monkeypatch.setattr(events,'refresh_access',lambda *_: ('synthetic-access','rotated-private'))
    def fail(*_):
        raise events.GoogleEventsError(503,'구글 요청이 일시적으로 제한되었습니다.')
    monkeypatch.setattr(events,'list_primary',fail)
    response=check(auth)
    assert response.status_code==200
    result=response.json()
    assert result['google_state']=='unavailable' and result['conflicts'][0]['id']==task['id']
    with TestingSession() as db:
        row=db.get(GoogleCalendarConnection,connection_user(auth))
        assert google.decrypt(google.configuration(),row.user_id,'refresh',row.refresh_token_ciphertext)=='rotated-private'
    assert 'rotated-private' not in response.text and 'synthetic-access' not in response.text


def test_expired_connection_warns_instead_of_reporting_no_conflicts(setup,monkeypatch):
    auth=connected(setup)
    calls=provider(monkeypatch,{'items':[]})
    with TestingSession() as db:
        db.get(GoogleCalendarConnection,connection_user(auth)).refresh_expires_at=datetime.now(UTC)-timedelta(days=1)
        db.commit()
    result=check(auth).json()
    assert result['google_state']=='reconnect_required' and result['google_message'] and not result['conflicts']
    assert calls==[]


def test_repeating_preview_reads_ninety_days_once_and_marks_provider_page_limit(setup,monkeypatch):
    auth=connected(setup)
    calls=provider(monkeypatch,{'items':[timed('future',start={'dateTime':'2027-01-11T15:00:00+09:00'},end={'dateTime':'2027-01-11T16:00:00+09:00'})], 'nextPageToken':'opaque'})
    result=check(auth,recurrence={'frequency':'weekly'}).json()
    assert result['google_state']=='partial' and result['coverage_limited']
    assert len(calls)==2 and calls[0][2]-calls[0][1]==timedelta(days=90)
    assert result['conflicts'][0]['id']=='future'


def test_all_day_end_is_exclusive_and_overflowing_date_is_not_silently_clear(setup,monkeypatch):
    auth=connected(setup)
    provider(monkeypatch,{'items':[{'id':'ended','start':{'date':'2026-11-15'},'end':{'date':'2026-11-16'}}]})
    result=check(auth).json()
    assert result['google_state']=='checked' and result['conflicts']==[]
    provider(monkeypatch,{'items':[{'id':'overflow','start':{'date':'0001-01-01'},'end':{'date':'0001-01-02'}}]})
    result=check(auth).json()
    assert result['google_state']=='partial' and result['google_message']
