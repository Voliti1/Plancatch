"""Only the final owned deadline removes its source, transactionally and after user intent."""
import io
import uuid

import pytest
from PIL import Image
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import Analysis, Deadline, Source
from app.services import source_images
from tests.test_auth import TestingSession
from tests.test_source_delete_guard import deadline, material
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def own():
    return auth_headers('cleanup-' + uuid.uuid4().hex + '@example.com')


def test_last_deadline_removes_its_source_and_reviews_but_preserves_task():
    auth = own()
    source_id = material(auth)
    identity = deadline(auth, source_id)
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        analysis = Analysis(user_id=source.user_id, source_id=source.id, input_text='test',
                            input_hash='a' * 64, model='test', status='ready')
        db.add(analysis)
        db.flush()
        analysis_id = str(analysis.id)
        db.commit()
    task = client.post('/api/tasks', headers=auth, json={'title': '보존할 할 일', 'deadline_id': identity}).json()
    assert client.delete('/api/deadlines/' + identity, headers=auth).status_code == 204
    assert client.get('/api/sources/' + source_id, headers=auth).status_code == 404
    assert client.get('/api/ai-analyses/' + analysis_id, headers=auth).status_code == 404
    assert client.get('/api/tasks/' + task['id'], headers=auth).json()['deadline_id'] is None
    assert client.delete('/api/deadlines/' + identity, headers=auth).status_code == 404


def test_other_deadlines_and_unrelated_material_survive_until_the_last_delete():
    auth, other = own(), own()
    shared, unrelated, foreign = material(auth), material(auth), material(other)
    first, last = deadline(auth, shared), deadline(auth, shared)
    assert client.delete('/api/deadlines/' + first, headers=other).status_code == 404
    assert client.delete('/api/deadlines/' + first).status_code == 401
    assert client.delete('/api/deadlines/' + first, headers=auth).status_code == 204
    assert client.get('/api/sources/' + shared, headers=auth).status_code == 200
    assert client.get('/api/deadlines/' + last, headers=auth).status_code == 200
    assert client.delete('/api/deadlines/' + last, headers=auth).status_code == 204
    assert client.get('/api/sources/' + shared, headers=auth).status_code == 404
    assert client.get('/api/sources/' + unrelated, headers=auth).status_code == 200
    assert client.get('/api/sources/' + foreign, headers=other).status_code == 200


@pytest.mark.parametrize('mode', ['source', 'analysis'])
def test_processing_source_keeps_both_records_and_allows_retry(mode):
    auth = own()
    source_id = material(auth)
    identity = deadline(auth, source_id)
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        if mode == 'source':
            source.processing_status = 'processing'
        else:
            db.add(Analysis(user_id=source.user_id, source_id=source.id, input_text='test',
                            input_hash='b' * 64, model='test', status='processing'))
        db.commit()
    response = client.delete('/api/deadlines/' + identity, headers=auth)
    assert response.status_code == 409 and response.json()['detail'] == 'deadline_source_busy'
    assert client.get('/api/deadlines/' + identity, headers=auth).status_code == 200
    assert client.get('/api/sources/' + source_id, headers=auth).status_code == 200
    with TestingSession() as db:
        db.get(Source, uuid.UUID(source_id)).processing_status = 'extracted'
        for row in db.query(Analysis).filter(Analysis.source_id == uuid.UUID(source_id)):
            row.status = 'ready'
        db.commit()
    assert client.delete('/api/deadlines/' + identity, headers=auth).status_code == 204


def test_image_is_removed_only_after_successful_commit(tmp_path, monkeypatch):
    monkeypatch.setattr(source_images, 'ROOT', tmp_path / 'images')
    auth = own()
    picture = io.BytesIO()
    Image.new('RGB', (40, 40), 'white').save(picture, format='PNG')
    source = client.post('/api/sources/images', headers=auth,
                        files={'file': ('synthetic.png', picture.getvalue(), 'image/png')}).json()
    identity = deadline(auth, source['id'])
    with TestingSession() as db:
        key = db.get(Source, uuid.UUID(source['id'])).storage_key
    path = source_images.image_path(key)
    assert path.is_file()
    def reject_commit(session):
        if any(isinstance(item, Source) for item in session.deleted):
            raise RuntimeError('synthetic commit failure')
    event.listen(Session, 'before_commit', reject_commit)
    try:
        with pytest.raises(RuntimeError, match='synthetic commit failure'):
            client.delete('/api/deadlines/' + identity, headers=auth)
    finally:
        event.remove(Session, 'before_commit', reject_commit)
    assert path.is_file()
    assert client.get('/api/deadlines/' + identity, headers=auth).status_code == 200
    assert client.get('/api/sources/' + source['id'], headers=auth).status_code == 200
    assert client.delete('/api/deadlines/' + identity, headers=auth).status_code == 204
    assert not path.exists()


def test_deadline_without_source_does_not_remove_unrelated_material():
    auth = own()
    source_id = material(auth)
    identity = deadline(auth, None)
    assert client.delete('/api/deadlines/' + identity, headers=auth).status_code == 204
    assert client.get('/api/sources/' + source_id, headers=auth).status_code == 200


def test_inconsistent_legacy_link_never_deletes_another_owners_source():
    auth, other = own(), own()
    source_id = material(other)
    identity = deadline(auth, None)
    with TestingSession() as db:
        db.get(Deadline, uuid.UUID(identity)).source_id = uuid.UUID(source_id)
        db.commit()
    assert client.delete('/api/deadlines/' + identity, headers=auth).status_code == 204
    assert client.get('/api/sources/' + source_id, headers=other).status_code == 200
