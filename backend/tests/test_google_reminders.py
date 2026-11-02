"""Reminder policy validation and fake-provider delivery, including legacy preservation."""
import copy
import uuid

import pytest
from pydantic import ValidationError

from app.models import Deadline
from app.schemas.google_reminders import GoogleReminders
from app.services import google_reminders as reminders
from app.services import google_sync as sync
from tests.test_auth import TestingSession
from tests.test_google_auto_sync import automatic as automatic  # noqa: PLC0414
from tests.test_google_auto_sync import state
from tests.test_google_calendar import setup as setup  # noqa: PLC0414
from tests.test_google_exports import deadline
from tests.test_sources import configure_test_jwt as configure_test_jwt  # noqa: PLC0414

CUSTOM = {"mode":"custom","overrides":[{"method":"popup","minutes":30},{"method":"email","minutes":1440}]}


@pytest.mark.parametrize("value", [
    {"mode":"custom","overrides":[]}, {"mode":"none","overrides":[{"method":"popup","minutes":0}]},
    {"mode":"default","overrides":[{"method":"popup","minutes":0}]}, {"mode":"unknown"},
    *[{"mode":"custom","overrides":[{"method":"popup","minutes":value}]} for value in (-1,40321,True,"30",0.5,None)],
    {"mode":"custom","overrides":[{"method":"sms","minutes":1}]},
    {"mode":"custom","overrides":[{"method":"popup","minutes":1}]*2},
    {"mode":"custom","overrides":[{"method":"email","minutes":i} for i in range(6)]},
    {"mode":"none","useDefault":True},
])
def test_invalid_policies_are_rejected(value):
    with pytest.raises(ValidationError):
        GoogleReminders.model_validate(value)


@pytest.mark.parametrize(("policy","expected"),[
    ({"mode":"none"},{"useDefault":False,"overrides":[]}),
    ({"mode":"default"},{"useDefault":True}),
    (CUSTOM,{"useDefault":False,"overrides":[{"method":"email","minutes":1440},{"method":"popup","minutes":30}]}),
])
def test_payload_conversion_and_semantic_comparison(policy,expected):
    assert reminders.provider_value(policy)==expected
    actual=copy.deepcopy(expected)
    if "overrides" in actual:
        actual["overrides"].reverse()
    assert reminders.matches(actual,{"reminders":expected})
    assert not reminders.matches(None,{"reminders":expected})
    assert reminders.matches({"useDefault":False},{"reminders":{"useDefault":False,"overrides":[]}})
    assert reminders.matches({"useDefault":True},{"summary":"legacy"})


@pytest.mark.parametrize("kind",["tasks","deadlines"])
def test_owned_policy_create_update_and_delivery(setup,automatic,kind):
    auth,_,remote,writes,_,_,rows,drain=automatic
    data={"title":"알림 검사","google_reminders":CUSTOM}
    if kind=="tasks":
        data.update(schedule_type="fixed",earliest_start="2026-11-15T10:00:00+09:00",latest_end="2026-11-15T11:00:00+09:00")
    else:
        data.update(due_at="2026-11-15T23:59:00+09:00",is_confirmed=True)
    response=setup.client.post('/api/'+kind,headers=auth,json=data)
    assert response.status_code==201
    identity=response.json()["id"]
    assert response.json()["google_reminders"]==GoogleReminders.model_validate(CUSTOM).model_dump()
    drain()
    saved=next(iter(remote.values()))
    assert saved["reminders"]==reminders.provider_value(CUSTOM) and writes==["POST"]
    before=(saved["summary"],saved["start"],saved["end"])
    response=setup.client.patch('/api/'+kind+'/'+identity,headers=auth,json={"google_reminders":{"mode":"none"}})
    assert response.status_code==200
    drain()
    saved=next(iter(remote.values()))
    assert writes==["POST","PATCH"] and saved["reminders"]=={"useDefault":False,"overrides":[]}
    assert (saved["summary"],saved["start"],saved["end"])==before
    count=len(writes)
    setup.client.patch('/api/'+kind+'/'+identity,headers=auth,json={"description":"로컬 메모만 변경"})
    drain()
    assert len(writes)==count and not rows()[0].sync_pending
    assert setup.client.patch('/api/'+kind+'/'+identity,headers=auth,json={"google_reminders":None}).status_code==422


def test_lost_reminder_update_response_is_not_repeated(setup,automatic):
    auth,_,remote,writes,_,failure,rows,drain=automatic
    target=deadline(setup,auth);drain()
    identity=rows()[0].google_event_id
    setup.client.patch('/api/deadlines/'+target['item_id'],headers=auth,json={"google_reminders":CUSTOM})
    failure['after']='PATCH';drain();drain(force_retry=True)
    assert writes==['POST','PATCH'] and rows()[0].google_event_id==identity
    assert remote[identity]['reminders']==reminders.provider_value(CUSTOM)


def test_remote_reminder_edit_stops_overwrite(setup,automatic):
    auth,_,remote,writes,_,_,_,drain=automatic
    target=deadline(setup,auth);drain()
    next(iter(remote.values()))['reminders']={"useDefault":False,"overrides":[{"method":"popup","minutes":77}]}
    setup.client.patch('/api/deadlines/'+target['item_id'],headers=auth,json={'title':'새 제목'})
    drain()
    assert writes==['POST'] and state(setup,auth,target)['state']=='failed'


def test_legacy_unmanaged_alarm_is_preserved_on_title_edit(setup,automatic):
    auth,user_id,remote,writes,_,_,rows,drain=automatic
    target=deadline(setup,auth)
    with TestingSession() as db:
        db.get(Deadline,uuid.UUID(target['item_id'])).google_reminders=None
        sync.enqueue_deadline(db,user_id,uuid.UUID(target['item_id']))
        db.commit()
    drain()
    row=rows()[0]
    alarm={"useDefault":False,"overrides":[{"method":"email","minutes":120}]}
    remote[row.google_event_id]['reminders']=alarm
    before=list(writes)
    setup.client.patch('/api/deadlines/'+target['item_id'],headers=auth,json={'title':'기존 알림 유지'})
    drain()
    assert remote[row.google_event_id]['reminders']==alarm and writes==before+['PATCH']
