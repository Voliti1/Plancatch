import json
import uuid
from datetime import UTC, datetime

import pytest

from app.models import Task
from app.services import ai_analysis as ai
from app.services import task_plans
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
from tests.test_sources import client, configure_test_jwt  # noqa: F401

WORK = [{'key':'first', 'title':'자료 조사', 'description':'필요한 자료 정리', 'estimated_minutes':60, 'priority':2, 'days_before_deadline':1, 'depends_on':[]},
    {'key':'second', 'title':'최종 검토', 'description':'조사 후 확인', 'estimated_minutes':60, 'priority':5, 'days_before_deadline':0, 'depends_on':['first']}]


@pytest.fixture(autouse=True)
def provider(monkeypatch):
    calls=[]
    monkeypatch.setattr(task_plans,'now',lambda:datetime(2026,11,10,tzinfo=UTC))
    monkeypatch.setattr(ai,'configured_model',lambda:'test-model')
    def send(payload, model):
        calls.append(payload)
        return {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'tasks':WORK},ensure_ascii=False)}]}}]}
    monkeypatch.setattr(ai,'provider_request',send)
    return calls


def deadline(auth):
    return client.post('/api/deadlines',headers=auth,json={'title':'보고서 제출','description':'직접 확인한 제출 안내','due_at':'2026-11-30T18:00:00+09:00'}).json()


def generate(auth,due,**extra):
    return client.post('/api/deadlines/'+due['id']+'/task-proposals',headers=auth,
        json={'request_id':str(uuid.uuid4()),'allow_external_ai':True,**extra})


def decision(auth,plan,action='approve',revision=None):
    return client.post('/api/task-proposals/'+plan['id']+'/'+action,headers=auth,json={'revision':revision or plan['revision']})


def review(auth,plan,candidates):
    return client.patch('/api/task-proposals/'+plan['id'],headers=auth,json={'revision':plan['revision'],'candidates':candidates})


def link(auth,child,parents,revision=None):
    path='/api/tasks/'+child['id']+'/dependencies'
    current=client.get(path,headers=auth).json()
    return client.put(path,headers=auth,json={'revision':revision or current['revision'],'predecessor_ids':[p['id'] for p in parents]})


def test_generation_consent_ownership_request_retry_and_no_tasks_until_approval(provider):
    auth=owner();due=deadline(auth);request=str(uuid.uuid4())
    assert generate(auth,due,allow_external_ai=False).status_code==422 and not provider
    assert generate(owner(),due).status_code==404 and not provider
    result=generate(auth,due,request_id=request)
    assert result.status_code==201,result.text
    plan=result.json()
    assert plan['status']=='ready' and len(plan['candidates'])==2 and plan['warnings']
    assert client.get('/api/tasks',headers=auth).json()==[] and not events(auth)
    assert generate(auth,due,request_id=request,allow_external_ai=False).json()['id']==plan['id'] and len(provider)==1
    assert generate(auth,due,request_id=request,notes='different').status_code==409
    foreign=owner()
    assert client.get('/api/task-proposals/'+plan['id'],headers=foreign).status_code==404
    assert decision(foreign,plan).status_code==404
    assert '직접 확인한 제출 안내' in provider[0]['contents'][0]['parts'][0]['text']


def test_review_and_atomic_approval_preserve_order_and_retry_receipt_after_task_deletion():
    auth=owner();plan=generate(auth,deadline(auth)).json()
    candidates=plan['candidates'];candidates[0]['title']='수정한 조사'
    changed=review(auth,plan,candidates)
    assert changed.status_code==200
    assert decision(auth,plan).status_code==409
    plan=changed.json();result=decision(auth,plan)
    assert result.status_code==200,result.text
    receipt=result.json();assert len(receipt['approved_task_ids'])==2 and not events(auth)
    tasks=client.get('/api/tasks',headers=auth).json()
    first=next(t for t in tasks if t['title']=='수정한 조사');second=next(t for t in tasks if t['title']=='최종 검토')
    assert client.get('/api/tasks/'+second['id']+'/dependencies',headers=auth).json()['predecessor_ids']==[first['id']]
    assert client.delete('/api/tasks/'+first['id'],headers=auth).status_code==204
    assert decision(auth,plan).json()['approved_task_ids']==receipt['approved_task_ids']
    assert len(client.get('/api/tasks',headers=auth).json())==1


def test_dependency_closure_cycles_duplicate_keys_and_bad_ai_are_rejected(monkeypatch):
    auth=owner();due=deadline(auth);plan=generate(auth,due).json()
    candidates=plan['candidates'];candidates[0]['selected']=False
    changed=review(auth,plan,candidates).json()
    assert decision(auth,changed).status_code==422
    candidates[0]['selected']=True;candidates[0]['depends_on']=[candidates[1]['id']]
    assert review(auth,changed,candidates).status_code==422
    bad=[{**t,'depends_on':['second'] if t['key']=='first' else ['first']} for t in WORK]
    monkeypatch.setattr(ai,'provider_request',lambda *args:{'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'tasks':bad})}]}}]})
    assert generate(auth,due).status_code==502
    assert client.get('/api/tasks',headers=auth).json()==[]
    assert decision(auth,changed,'reject').json()['status']=='rejected'
    assert decision(auth,changed).status_code==409


def test_deadline_changes_during_generation_or_before_approval_never_register_stale_tasks(monkeypatch):
    auth=owner();due=deadline(auth);plan=generate(auth,due).json()
    client.patch('/api/deadlines/'+due['id'],headers=auth,json={'title':'바뀐 제목'})
    assert decision(auth,plan).status_code==409
    original=task_plans.provider
    def changed(*args):
        result=original(*args)
        client.patch('/api/deadlines/'+due['id'],headers=auth,json={'title':str(uuid.uuid4())})
        return result
    monkeypatch.setattr(task_plans,'provider',changed)
    assert generate(auth,due).status_code==409
    assert client.get('/api/tasks',headers=auth).json()==[]


def test_dependency_edit_is_owned_revision_checked_acyclic_and_prevents_fixed_conversion():
    auth=owner();a=task(auth);b=task(auth);foreign=task(owner())
    original=client.get('/api/tasks/'+b['id']+'/dependencies',headers=auth).json()['revision']
    assert link(auth,b,[foreign]).status_code==404
    assert link(auth,b,[a]).status_code==200
    assert link(auth,b,[],original).status_code==409
    assert link(auth,a,[b]).status_code==422
    assert link(auth,a,[a]).status_code==422
    assert client.patch('/api/tasks/'+a['id'],headers=auth,json={'schedule_type':'fixed'}).status_code==409
    assert client.delete('/api/tasks/'+a['id'],headers=auth).status_code==204
    assert client.get('/api/tasks/'+b['id']+'/dependencies',headers=auth).json()['predecessor_ids']==[]


def test_planner_uses_prerequisite_order_even_when_child_priority_and_deadline_win_and_checks_edited_order():
    auth=owner();a=task(auth,priority=1,estimated_minutes=60);b=task(auth,priority=5,estimated_minutes=60)
    assert link(auth,b,[a]).status_code==200
    plan=preview(auth,[b,a],include_google=False).json()
    assert [x['task_id'] for x in plan['blocks']]==[a['id'],b['id']]
    edited=[{k:x[k] for k in ('id','start_at','end_at')} for x in plan['blocks']]
    edited[0]['start_at'],edited[0]['end_at']=edited[1]['start_at'],edited[1]['end_at']
    edited[1]['start_at']='2026-11-16T00:00:00Z';edited[1]['end_at']='2026-11-16T01:00:00Z'
    assert approve(auth,plan,edited).status_code==422 and not events(auth)
    assert approve(auth,plan).status_code==200


def test_unselected_unfinished_predecessor_blocks_child_and_new_connections_invalidate_old_preview():
    auth=owner();a=task(auth,estimated_minutes=60);b=task(auth,estimated_minutes=60)
    old=preview(auth,[b],include_google=False).json()
    link(auth,b,[a])
    assert approve(auth,old).status_code==409
    plan=preview(auth,[b],include_google=False).json()
    assert plan['blocks']==[] and plan['details']['unplaced']
    client.patch('/api/tasks/'+a['id'],headers=auth,json={'is_completed':True})
    with TestingSession() as db:
        db.get(Task,uuid.UUID(a['id'])).completed_at=datetime(2026,11,10,tzinfo=UTC);db.commit()
    assert preview(auth,[b],include_google=False).json()['blocks']


def test_already_fully_placed_predecessor_allows_later_child_and_changed_placement_invalidates_preview():
    auth=owner();a=task(auth,estimated_minutes=60);b=task(auth,estimated_minutes=60)
    initial=preview(auth,[a],include_google=False).json();assert approve(auth,initial).status_code==200
    link(auth,b,[a])
    plan=preview(auth,[b],include_google=False).json()
    assert plan['blocks'][0]['start_at']>=initial['blocks'][0]['end_at']
    identity=events(auth)[0]['id']
    assert client.delete('/api/scheduled-events/'+identity,headers=auth).status_code==204
    assert approve(auth,plan).status_code==409


@pytest.mark.parametrize('envelope', [
    {},
    {'candidates':[{'finishReason':'MAX_TOKENS','content':{'parts':[{'text':'{}'}]}}]},
    {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'tasks':[{**WORK[0],'estimated_minutes':True}]})}]}}]},
])
def test_incomplete_or_invalid_provider_output_is_not_saved(monkeypatch,envelope):
    auth=owner();due=deadline(auth)
    monkeypatch.setattr(ai,'provider_request',lambda *args:envelope)
    assert generate(auth,due).status_code==502
    page=client.get('/api/deadlines/'+due['id']+'/task-proposals',headers=auth).json()
    assert page['entries']==[] and not events(auth)


def test_provider_failure_does_not_leave_a_processing_record_or_leak_capacity(monkeypatch):
    auth=owner();due=deadline(auth);request=str(uuid.uuid4())
    with monkeypatch.context() as patch:
        def fail(*args):
            raise ai.AIError('ai_network_error')
        patch.setattr(ai,'provider_request',fail)
        assert generate(auth,due,request_id=request).status_code==502
    assert client.get('/api/deadlines/'+due['id']+'/task-proposals',headers=auth).json()['entries']==[]
    assert generate(auth,due,request_id=request).status_code==201
