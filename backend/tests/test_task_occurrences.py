"""Single occurrence CRUD, retained series boundaries and safe provider intents."""
import uuid
from datetime import datetime

from sqlalchemy import select

from app.models import Task
from app.services.natural_schedule import SEOUL, interpret
from app.services.recurrence import google_rule, same_google_rule
from tests.test_auth import TestingSession
from tests.test_google_auto_sync import automatic as automatic  # noqa: PLC0414
from tests.test_google_auto_sync import setup as setup  # noqa: PLC0414
from tests.test_recurrence import create
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

AT = '2026-11-09T23:30:00+09:00'
WINDOW = {'start_from':'2026-11-01T00:00:00+09:00','end_before':'2026-11-24T00:00:00+09:00'}


def path(task):
    return '/api/tasks/'+task['id']+'/occurrences'


def rows(auth):
    return client.get('/api/calendar/registrations',headers=auth,params=WINDOW).json()['entries']


def test_single_edit_move_and_delete_never_changes_other_dates_and_is_owned():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    other=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth).json()
    query={'original_start':AT}
    assert client.get(path(task),params=query).status_code==401
    assert client.get(path(task),headers=other,params=query).status_code==404
    current=client.get(path(task),headers=auth,params=query).json()
    assert current['recurrence'] is None and current['series_id']==task['id']
    assert current['earliest_start']=='2026-11-09T14:30:00Z'
    edit={'title':'이번 주만 변경','earliest_start':'2026-11-10T10:00:00+09:00','latest_end':'2026-11-10T11:00:00+09:00'}
    child=client.patch(path(task),headers=auth,params=query,json=edit)
    assert child.status_code==200,child.text
    child=child.json()
    assert child['id']!=task['id'] and child['series_id']==task['id']
    assert len(rows(auth))==3
    assert [r['title'] for r in rows(auth)]==['반복 회의','이번 주만 변경','반복 회의']
    # Repeating the same request updates one linked task, never duplicates it.
    assert client.patch(path(task),headers=auth,params=query,json=edit).json()['id']==child['id']
    assert len(client.get('/api/tasks',headers=auth).json())==2
    assert client.delete(path(task),headers=other,params=query).status_code==404
    assert client.delete(path(task),headers=auth,params=query).status_code==204
    assert client.delete(path(task),headers=auth,params=query).status_code==204
    assert len(rows(auth))==2  # Count still covers the original three dates.
    assert client.get(path(task),headers=auth,params=query).status_code==404
    assert client.patch(path(task),headers=auth,params=query,json=edit).status_code==404
    assert len(rows(other))==0


def test_invalid_occurrence_changes_are_rejected_and_rollback_does_not_exclude_date():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth).json()
    assert client.get(path(task),headers=auth,params={'original_start':'2026-11-10T23:30:00+09:00'}).status_code==404
    for change in [{'recurrence':None},{'schedule_type':'flexible'},{'title':''},
                   {'earliest_start':None},{'latest_end':'2026-11-01T00:00:00Z'}]:
        assert client.patch(path(task),headers=auth,params={'original_start':AT},json=change).status_code==422
    assert len(rows(auth))==3
    assert client.get('/api/tasks/'+task['id'],headers=auth).json()['exception_count']==0


def test_end_date_trim_preserves_in_range_changes_and_pattern_reset_requires_confirmation():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth).json()
    first=client.patch(path(task),headers=auth,params={'original_start':AT},json={'title':'유지할 개별 변경'}).json()
    later=client.patch(path(task),headers=auth,params={'original_start':'2026-11-16T23:30:00+09:00'},json={'title':'기간 밖 개별 변경'}).json()
    base='/api/tasks/'+task['id']
    trimmed=client.patch(base,headers=auth,json={'recurrence':{'frequency':'weekly','until':'2026-11-09'}})
    assert trimmed.status_code==200,trimmed.text
    assert trimmed.json()['exception_count']==1 and len(rows(auth))==2
    assert client.get('/api/tasks/'+later['id'],headers=auth).status_code==404
    assert client.get('/api/tasks/'+first['id'],headers=auth).status_code==200
    pattern={'recurrence':{'frequency':'daily','count':3}}
    assert client.patch(base,headers=auth,json=pattern).status_code==409
    assert client.patch(base,headers=auth,json={**pattern,'reset_occurrences':True}).status_code==200
    assert client.get('/api/tasks/'+first['id'],headers=auth).status_code==404
    assert len(rows(auth))==3
    assert client.get(base,headers=auth).json()['exception_count']==0


def test_whole_delete_removes_children_and_child_delete_keeps_cancelled_original():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth).json()
    child=client.patch(path(task),headers=auth,params={'original_start':AT},json={'title':'변경'}).json()
    assert client.delete('/api/tasks/'+child['id'],headers=auth).status_code==204
    assert len(rows(auth))==2
    child=client.patch(path(task),headers=auth,params={'original_start':'2026-11-16T23:30:00+09:00'},json={'title':'변경2'}).json()
    assert client.delete('/api/tasks/'+task['id'],headers=auth).status_code==204
    assert rows(auth)==[]
    assert client.get('/api/tasks/'+child['id'],headers=auth).status_code==404


def test_excluded_occurrence_is_absent_from_overlap_checks_and_own_occurrence_is_excluded_only():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth).json()
    draft={'start_at':AT,'end_at':'2026-11-10T00:30:00+09:00'}
    preview=lambda extra: client.post('/api/schedules/conflicts',headers=auth,json={**draft,**extra}).json()
    assert len(preview({})['conflicts'])==1
    assert preview({'exclude_occurrence_task_id':task['id'],'exclude_occurrence_start':AT})['conflicts']==[]
    assert client.delete(path(task),headers=auth,params={'original_start':AT}).status_code==204
    assert preview({})['conflicts']==[]


def test_google_exdate_and_stable_override_retry_then_series_delete(setup,automatic):
    auth,_,remote,writes,_,failure,exports,drain=automatic
    task=create(auth).json()
    drain()
    master=exports()[0].google_event_id
    failure['after']='PATCH'
    child=client.patch(path(task),headers=auth,params={'original_start':AT},json={'title':'이번 주만 변경'}).json()
    drain(force_retry=True)
    assert len(remote)==2 and writes.count('POST')==2
    expected=['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3','EXDATE:20261109T143000Z']
    assert remote[master]['recurrence']==expected
    assert same_google_rule(list(reversed(expected)),expected)
    assert not same_google_rule(expected,google_rule({'frequency':'weekly','count':3}))
    assert client.delete('/api/tasks/'+task['id'],headers=auth).status_code==204
    drain()
    assert not remote and writes.count('DELETE')==2
    assert client.get('/api/tasks/'+child['id'],headers=auth).status_code==404


def test_legacy_reminders_and_sentence_end_conditions():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth).json()
    with TestingSession() as db:
        db.scalar(select(Task).where(Task.id==uuid.UUID(task['id']))).google_reminders=None
        db.commit()
    assert client.patch(path(task),headers=auth,params={'original_start':AT},json={'title':'알림 유지'}).status_code==200
    now=datetime(2026,11,10,12,tzinfo=SEOUL)
    month=interpret('이번 달만 매일 오후 3시 운동',now=now)
    assert month.recurrence.until.isoformat()=='2026-11-30' and month.title=='운동'
    date=interpret('11월 25일까지 매주 월요일 오후 3시 회의',now=now)
    assert date.recurrence.until.isoformat()=='2026-11-25' and date.title=='회의'


def test_long_overlapping_series_membership_and_equivalent_provider_exclusion_zones():
    auth=auth_headers(uuid.uuid4().hex+'@example.com')
    task=create(auth,latest_end='2026-12-02T23:30:00+09:00').json()
    # A later occurrence remains selectable even while several earlier instances are still running.
    assert client.get(path(task),headers=auth,params={'original_start':'2026-11-16T23:30:00+09:00'}).status_code==200
    base=['RRULE:FREQ=WEEKLY;COUNT=3']
    assert same_google_rule(base+['EXDATE:20261109T143000Z'],base+['EXDATE;TZID=Asia/Seoul:20261109T233000'])
    assert not same_google_rule(base+['EXDATE:20261109T143000Z'],base+['EXDATE:20261109T143100Z'])
