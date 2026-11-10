"""Overlap previews never reserve time or expose another account's records."""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import ScheduledEvent, Task
from app.services.schedule_conflicts import preview
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

BASE = '/api/schedules/conflicts'
FIRST = '2026-11-16T15:00:00+09:00'
LAST = '2026-11-16T16:00:00+09:00'


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr('app.api.routes.schedule_conflicts.preview',
        lambda db, owner, request: preview(db,owner,request,now=datetime(2026,11,10,tzinfo=UTC)))


def owner():
    return auth_headers(uuid.uuid4().hex+'@example.com')


def task(auth, **changes):
    result=client.post('/api/tasks',headers=auth,json={
        'title':'기존 회의','schedule_type':'fixed','earliest_start':FIRST,'latest_end':LAST,**changes})
    assert result.status_code==201,result.text
    return result.json()


def check(auth, **changes):
    return client.post(BASE,headers=auth,json={'start_at':FIRST,'end_at':LAST,**changes})


def test_overlap_half_open_windows_self_exclusion_and_no_write():
    auth=owner(); existing=task(auth)
    with TestingSession() as db:
        before=db.scalar(select(func.count()).select_from(Task))
    result=check(auth)
    assert result.status_code==200 and result.headers['cache-control']=='no-store'
    assert result.json()['conflicts'][0]['id']==existing['id']
    assert check(auth,start_at=LAST,end_at='2026-11-16T17:00:00+09:00').json()['conflicts']==[]
    assert check(auth,start_at='2026-11-16T14:00:00+09:00',end_at=FIRST).json()['conflicts']==[]
    assert check(auth,exclude_task_id=existing['id']).json()['conflicts']==[]
    assert client.get('/api/tasks/'+existing['id'],headers=auth).json()['title']=='기존 회의'
    with TestingSession() as db:
        assert db.scalar(select(func.count()).select_from(Task))==before


def test_owned_only_and_invalid_exclusion_does_not_bypass_access_checks():
    auth,other=owner(),owner(); existing=task(auth,title='다른 사람의 비밀')
    assert check(other).json()['conflicts']==[]
    result=check(other,exclude_task_id=existing['id'])
    assert result.status_code==404 and '비밀' not in result.text
    assert client.post(BASE,json={'start_at':FIRST,'end_at':LAST}).status_code==401


def test_repeat_conflicts_after_first_occurrence_and_keeps_seoul_midnight():
    auth=owner()
    existing=task(auth,title='매주 야간 작업',earliest_start='2026-11-02T23:30:00+09:00',
        latest_end='2026-11-03T00:30:00+09:00',recurrence={'frequency':'weekly','count':4})
    result=check(auth,start_at='2026-11-17T00:00:00+09:00',end_at='2026-11-17T01:00:00+09:00').json()
    assert len(result['conflicts'])==1 and result['conflicts'][0]['id']==existing['id']
    assert result['conflicts'][0]['is_recurring']
    task(auth,title='둘째 회차만 겹침',earliest_start='2026-11-23T15:30:00+09:00',latest_end='2026-11-23T16:30:00+09:00')
    result=check(auth,recurrence={'frequency':'weekly','count':3}).json()
    assert [row['title'] for row in result['conflicts']]==['둘째 회차만 겹침']
    assert result['conflicts'][0]['proposed_start_at']=='2026-11-23T06:00:00+00:00'


def test_flexible_and_cancelled_or_unapproved_blocks_are_not_busy_and_placements_not_duplicated():
    auth=owner()
    flexible=task(auth,title='가능 시간일 뿐',schedule_type='flexible')
    assert check(auth).json()['conflicts']==[]
    fixed=task(auth,title='배치가 있는 회의')
    for status in ('cancelled','recommended','approved'):
        result=client.post('/api/scheduled-events',headers=auth,json={
            'task_id':fixed['id'],'start_at':FIRST,'end_at':LAST,'status':status})
        assert result.status_code==201
    result=check(auth).json()
    assert len(result['conflicts'])==1 and result['conflicts'][0]['kind']=='event'
    event_id=result['conflicts'][0]['id']
    assert check(auth,exclude_task_id=fixed['id']).json()['conflicts']==[]
    assert check(auth,placement_task_id=fixed['id'],exclude_event_id=event_id).json()['conflicts']==[]
    with TestingSession() as db:
        assert db.scalar(select(func.count()).select_from(ScheduledEvent).where(ScheduledEvent.task_id==uuid.UUID(fixed['id'])))==3
    assert check(owner(),placement_task_id=flexible['id']).status_code==404
    assert check(owner(),exclude_event_id=event_id).status_code==404


def test_bounded_result_and_repeat_coverage_are_never_reported_as_complete():
    auth=owner()
    for index in range(22): task(auth,title=f'겹치는 일정 {index}')
    result=check(auth).json()
    assert len(result['conflicts'])==20 and result['truncated']
    result=check(auth,recurrence={'frequency':'daily'}).json()
    assert result['coverage_limited'] and result['is_recurring'] and result['scope']=='local'
    assert datetime.fromisoformat(result['checked_until'])-datetime.fromisoformat(result['checked_from']) == timedelta(days=90)


@pytest.mark.parametrize('changes',[
    {'end_at':FIRST},{'start_at':'2026-11-16T15:00:00'},
    {'recurrence':{'frequency':'daily','until':'2026-11-01'}},{'unknown':True},
])
def test_invalid_check_does_not_create_a_schedule(changes):
    auth=owner()
    assert check(auth,**changes).status_code==422
    assert client.get('/api/tasks',headers=auth).json()==[]
