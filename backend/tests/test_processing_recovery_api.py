"""An interrupted URL review can be explicitly retried without reusing its failure."""
import uuid
from datetime import datetime, timedelta, timezone

from app.models import Analysis
from app.services import ai_analysis as ai
from app.services.processing_recovery import INTERRUPTED, recover_interrupted
from tests.test_auth import TestingSession
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_saramin_period import document
from tests.test_sources import client, configure_test_jwt  # noqa: F401


def test_explicit_url_retry_keeps_failure_and_creates_one_new_review_without_ai(monkeypatch):
    forbid_ai(monkeypatch)
    source_id,headers=source_ready(document().text)
    with TestingSession() as db:
        from app.models import Source
        source=db.get(Source,uuid.UUID(source_id))
        old=Analysis(user_id=source.user_id,source_id=source.id,input_text=source.extracted_text,
            input_hash=ai.content_hash(source.extracted_text),model='html:saramin:v1',status='processing',
            processing_run_id=uuid.uuid4(),processing_lease_until=datetime.now(timezone.utc)-timedelta(seconds=1))
        db.add(old);db.commit();old_id=old.id
    assert recover_interrupted(TestingSession.kw['bind'])['analyses']==1
    path=f'/api/sources/{source_id}/ai-analyses'
    payload={'reuse_existing':True,'allow_external_ai':False,'input_hash':ai.content_hash(document().text)}
    first=client.post(path,headers=headers,json=payload)
    assert first.status_code==202 and first.json()['id']!=str(old_id)
    current=client.get('/api/ai-analyses/'+first.json()['id'],headers=headers)
    assert current.json()['status']=='ready'
    second=client.post(path,headers=headers,json=payload)
    assert second.json()['id']==first.json()['id']
    previous=client.get('/api/ai-analyses/'+str(old_id),headers=headers).json()
    assert previous['status']=='failed' and previous['error_message']==INTERRUPTED
    assert client.get('/api/deadlines',headers=headers).json()==[]
