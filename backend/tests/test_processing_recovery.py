"""Expired attempts recover without replaying providers or overwriting a later run."""
import uuid
from datetime import timedelta
from threading import BoundedSemaphore

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import Analysis, Source, User
from app.schemas.analysis import ProviderResult
from app.services import ai_analysis, source_processing
from app.services import processing_recovery as recovery
from app.services.extraction import Document


@pytest.fixture
def engine():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def saved(engine, kind='url', *, with_analysis=False):
    with Session(engine) as db:
        user = User(email=uuid.uuid4().hex+'@example.com', password_hash='test')
        db.add(user);db.flush()
        source = Source(user_id=user.id, source_type=kind, original_url='https://example.com/notice',
                        original_text='keep original', extracted_text='keep snapshot',
                        title='keep title', processing_status='processing', storage_key='keep-private-key')
        token = recovery.begin_processing(source)
        db.add(source);db.flush()
        identity = None
        if with_analysis:
            analysis = Analysis(user_id=user.id, source_id=source.id, input_text='keep snapshot',
                input_hash=ai_analysis.content_hash('keep snapshot'), model='test-model', status='processing')
            recovery.begin_processing(analysis, token)
            db.add(analysis);db.flush();identity = analysis.id
        db.commit()
        return source.id, identity, token


def test_expired_source_recovers_once_and_keeps_all_user_material(engine):
    identity, _, _ = saved(engine)
    with Session(engine) as db:
        row = db.get(Source,identity);row.processing_lease_until=recovery.now()-timedelta(seconds=1);db.commit()
    assert recovery.recover_interrupted(engine)=={'sources':1,'analyses':0}
    assert recovery.recover_interrupted(engine)=={'sources':0,'analyses':0}
    with Session(engine) as db:
        row=db.get(Source,identity)
        assert row.processing_status=='failed' and row.error_message==recovery.INTERRUPTED
        assert row.processing_run_id is row.processing_lease_until is None
        assert row.original_text=='keep original' and row.extracted_text=='keep snapshot'
        assert row.title=='keep title' and row.storage_key=='keep-private-key'


@pytest.mark.parametrize('kind',['image','pdf'])
def test_file_source_and_analysis_are_recovered_together(engine,kind):
    source_id,analysis_id,_=saved(engine,kind,with_analysis=True)
    with Session(engine) as db:
        db.get(Source,source_id).processing_lease_until=recovery.now()-timedelta(seconds=1)
        db.get(Analysis,analysis_id).processing_lease_until=recovery.now()-timedelta(seconds=1)
        db.commit()
    assert recovery.recover_interrupted(engine)=={'sources':1,'analyses':1}
    with Session(engine) as db:
        source,analysis=db.get(Source,source_id),db.get(Analysis,analysis_id)
        assert source.processing_status==analysis.status=='failed'
        assert source.error_message==analysis.error_message==recovery.INTERRUPTED
        assert analysis.input_text==source.extracted_text=='keep snapshot'
        assert source.storage_key=='keep-private-key'


@pytest.mark.parametrize('expire_source', [False, True])
def test_interrupted_image_correction_keeps_previous_text_usable(engine, expire_source):
    source_id, analysis_id, token = saved(engine, 'image', with_analysis=True)
    with Session(engine) as db:
        source, analysis = db.get(Source, source_id), db.get(Analysis, analysis_id)
        analysis.model = 'image:corrected-text'
        analysis.input_text = 'new correction not yet accepted'
        analysis.processing_lease_until = recovery.now() - timedelta(seconds=1)
        if expire_source:
            source.processing_lease_until = analysis.processing_lease_until
        db.commit()
    lease = recovery.ProcessingLease(engine, analysis_id=analysis_id, run_id=token)
    assert recovery.recover_interrupted(engine) == {'sources': 1, 'analyses': 1}
    with Session(engine) as db:
        source, analysis = db.get(Source, source_id), db.get(Analysis, analysis_id)
        assert source.processing_status == 'extracted' and source.error_message is None
        assert source.extracted_text == 'keep snapshot' and source.title == 'keep title'
        assert analysis.status == 'failed' and analysis.error_message == recovery.INTERRUPTED
        assert not lease.owns(source) and not lease.owns(analysis)
        assert source.processing_run_id is analysis.processing_run_id is None
    assert recovery.recover_interrupted(engine) == {'sources': 0, 'analyses': 0}


def test_healthy_lease_on_another_worker_is_not_recovered_and_renewal_extends_it(engine,monkeypatch):
    source_id,_,token=saved(engine)
    start=recovery.now()
    lease=recovery.ProcessingLease(engine,source_id=source_id,run_id=token)
    assert lease.start()
    try:
        monkeypatch.setattr(recovery,'now',lambda:start+timedelta(seconds=60))
        assert lease.renew()
        assert recovery.recover_interrupted(engine,at=start+timedelta(seconds=150))=={'sources':0,'analyses':0}
    finally:lease.close()


def test_wrong_run_cannot_start_and_expired_owner_cannot_renew(engine):
    source_id,_,token=saved(engine)
    wrong=recovery.ProcessingLease(engine,source_id=source_id,run_id=uuid.uuid4())
    assert not wrong.start()
    lease=recovery.ProcessingLease(engine,source_id=source_id,run_id=token)
    with Session(engine) as db:
        db.get(Source,source_id).processing_lease_until=recovery.now()-timedelta(seconds=1);db.commit()
    assert not lease.renew() and lease.lost.is_set()


def test_legacy_processing_has_a_grace_period_and_ready_data_is_never_recovered(engine):
    old,_,_=saved(engine);fresh,_,_=saved(engine);ready,_,_=saved(engine)
    with Session(engine) as db:
        for identity in (old,fresh,ready):recovery.finish_processing(db.get(Source,identity))
        db.get(Source,old).updated_at=recovery.now()-timedelta(seconds=901)
        db.get(Source,fresh).updated_at=recovery.now()
        db.get(Source,ready).processing_status='extracted'
        db.get(Source,ready).updated_at=recovery.now()-timedelta(days=1)
        db.commit()
    assert recovery.recover_interrupted(engine)=={'sources':1,'analyses':0}
    with Session(engine) as db:
        assert db.get(Source,fresh).processing_status=='processing'
        assert db.get(Source,ready).processing_status=='extracted'


def test_late_download_never_overwrites_retried_same_source(engine,monkeypatch):
    source_id,_,token=saved(engine)
    next_token=uuid.uuid4()
    def download(*_):
        with Session(engine) as db:
            db.get(Source,source_id).processing_lease_until=recovery.now()-timedelta(seconds=1);db.commit()
        assert recovery.recover_interrupted(engine)['sources']==1
        with Session(engine) as db:
            row=db.get(Source,source_id);row.processing_status='processing';row.extracted_text='new attempt'
            recovery.begin_processing(row,next_token);db.commit()
        return Document('old late result','wrong old title')
    monkeypatch.setattr(source_processing,'extract',download)
    slots=BoundedSemaphore(1);assert slots.acquire(blocking=False)
    monkeypatch.setattr(source_processing,'slots',slots)
    source_processing.process_source(source_id,engine,token)
    with Session(engine) as db:
        row=db.get(Source,source_id)
        assert row.processing_status=='processing' and row.processing_run_id==next_token
        assert row.extracted_text=='new attempt' and row.title=='keep title'
    assert slots.acquire(blocking=False)


def test_late_provider_result_stays_failed_and_creates_no_deadlines(engine,monkeypatch):
    source_id,analysis_id,token=saved(engine,'text',with_analysis=True)
    with Session(engine) as db:
        row=db.get(Source,source_id);row.processing_status='extracted';recovery.finish_processing(row);db.commit()
    def analyze(*_):
        with Session(engine) as db:
            db.get(Analysis,analysis_id).processing_lease_until=recovery.now()-timedelta(seconds=1);db.commit()
        assert recovery.recover_interrupted(engine)['analyses']==1
        return ProviderResult(deadlines=[],warnings=[])
    monkeypatch.setattr(ai_analysis,'analyze_text',analyze)
    slots=BoundedSemaphore(1);assert slots.acquire(blocking=False)
    monkeypatch.setattr(ai_analysis,'slots',slots)
    ai_analysis.process_analysis(analysis_id,engine,token)
    with Session(engine) as db:
        assert db.get(Analysis,analysis_id).status=='failed'
        assert db.get(Analysis,analysis_id).error_message==recovery.INTERRUPTED
        assert db.get(Source,source_id).processing_status=='extracted'
        assert db.scalars(select(Analysis)).all()[0].candidates==[]
    assert slots.acquire(blocking=False)


def test_recovery_is_bounded_and_preserves_ready_and_approved_analysis_history(engine):
    ids=[saved(engine) for _ in range(3)]
    with Session(engine) as db:
        for identity,_,_ in ids:db.get(Source,identity).processing_lease_until=recovery.now()-timedelta(seconds=1)
        db.commit()
    assert recovery.recover_interrupted(engine,limit=2)['sources']==2
    assert recovery.recover_interrupted(engine,limit=2)['sources']==1
    source_id,analysis_id,_=saved(engine,'text',with_analysis=True)
    with Session(engine) as db:
        source=db.get(Source,source_id);source.processing_status='extracted';recovery.finish_processing(source)
        analysis=db.get(Analysis,analysis_id);analysis.status='approved'
        analysis.processing_lease_until=recovery.now()-timedelta(days=1);db.commit()
    assert recovery.recover_interrupted(engine)=={'sources':0,'analyses':0}


def test_application_lifespan_recovers_stale_jobs_without_any_external_replay(engine,monkeypatch):
    from threading import Event
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app import main

    identity,_,_=saved(engine)
    with Session(engine) as db:
        db.get(Source,identity).processing_lease_until=recovery.now()-timedelta(seconds=1);db.commit()
    monkeypatch.setattr(main,'get_settings',lambda:SimpleNamespace(db_host='test-only'))
    monkeypatch.setattr(main,'get_engine',lambda:engine)
    monkeypatch.setattr('app.services.google_sync.run_batch',lambda _:None)
    finished = Event()
    recover = recovery.recover_interrupted

    def recover_and_signal(database):
        counts = recover(database)
        finished.set()
        return counts

    monkeypatch.setattr(recovery, "recover_interrupted", recover_and_signal)
    with TestClient(FastAPI(lifespan=main.lifespan)):
        assert finished.wait(timeout=5), "Startup recovery was not run"
        with Session(engine) as db:
            assert db.get(Source, identity).processing_status == "failed"


def test_nullable_lease_migration_preserves_existing_rows_and_roundtrips_in_disposable_db():
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect, text

    path=Path(__file__).parents[1]/'migrations/versions/20261117_0016_processing_leases.py'
    spec=importlib.util.spec_from_file_location('lease_migration',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    temporary=create_engine('sqlite://')
    with temporary.begin() as db:
        db.execute(text('CREATE TABLE sources (id TEXT PRIMARY KEY, processing_status TEXT, original_text TEXT)'))
        db.execute(text('CREATE TABLE analyses (id TEXT PRIMARY KEY, status TEXT, input_text TEXT)'))
        db.execute(text("INSERT INTO sources VALUES ('original','extracted','keep')"))
        db.execute(text("INSERT INTO analyses VALUES ('original','approved','keep')"))
        module.op=Operations(MigrationContext.configure(db));module.upgrade()
        assert db.execute(text('SELECT original_text,processing_run_id,processing_lease_until FROM sources')).one()==('keep',None,None)
        assert db.execute(text('SELECT input_text,processing_run_id,processing_lease_until FROM analyses')).one()==('keep',None,None)
        assert 'ix_sources_processing_lease' in {i['name'] for i in inspect(db).get_indexes('sources')}
        assert 'ix_analyses_processing_lease' in {i['name'] for i in inspect(db).get_indexes('analyses')}
        module.downgrade()  # Only this disposable in-memory migration test, never deployment.
        assert db.scalar(text('SELECT original_text FROM sources'))=='keep'
    temporary.dispose()
