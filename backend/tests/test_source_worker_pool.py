"""A source download must not occupy the sole database connection."""
import uuid
from threading import BoundedSemaphore

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import QueuePool

from app.db.base import Base
from app.models import Source, User
from app.services import source_processing
from app.services.extraction import Document


def test_extraction_releases_database_connection_until_it_persists_result(monkeypatch):
    engine = create_engine("sqlite://", poolclass=QueuePool, pool_size=1, max_overflow=0,
                           pool_timeout=0.1)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            user = User(email=uuid.uuid4().hex + "@example.com", password_hash="test")
            db.add(user)
            db.flush()
            source = Source(user_id=user.id, source_type="url", original_url="https://example.com/notice",
                            processing_status="processing")
            db.add(source)
            db.commit()
            identity = source.id
        slots = BoundedSemaphore(1)
        assert slots.acquire(blocking=False)
        monkeypatch.setattr(source_processing, "slots", slots)
        def download(*_):
            # Stand in for another request while the external download is pending.
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT 1")) == 1
            return Document("마감 2026.11.01 18:00", "공고 제목")
        monkeypatch.setattr(source_processing, "extract", download)
        source_processing.process_source(identity, engine)
        with Session(engine) as db:
            saved = db.scalar(select(Source).where(Source.id == identity))
            assert saved.processing_status == "extracted"
            assert saved.title == "공고 제목" and saved.extracted_text == "마감 2026.11.01 18:00"
        assert slots.acquire(blocking=False)
    finally:
        engine.dispose()
