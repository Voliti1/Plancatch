"""Expiring attempt ownership; recovery never resends user material to a provider."""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from threading import Event, Thread

from sqlalchemy import and_, or_, select, text
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.source import Source

LEASE_SECONDS = 120
HEARTBEAT_SECONDS = 20
RECOVERY_SECONDS = 10
LEGACY_GRACE_SECONDS = 900
INTERRUPTED = "processing_interrupted"
logger = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def begin_processing(record, run_id=None):
    run_id = run_id or uuid.uuid4()
    record.processing_run_id = run_id
    record.processing_lease_until = now() + timedelta(seconds=LEASE_SECONDS)
    return run_id


def finish_processing(record):
    record.processing_run_id = record.processing_lease_until = None


def is_processing(record):
    return (record.processing_status if isinstance(record, Source) else record.status) == "processing"


def interrupt(record):
    if isinstance(record, Source):
        record.processing_status = "failed"
    else:
        record.status = "failed"
    record.error_message = INTERRUPTED
    finish_processing(record)


def interrupt_file_source(source, analyses):
    # A correction attempts a new review of existing text; keep that last usable text.
    if (source.source_type == "image" and source.extracted_text
            and any(a.model == "image:corrected-text" for a in analyses)):
        source.processing_status = "extracted"
        source.error_message = None
        finish_processing(source)
    else:
        interrupt(source)


class ProcessingLease:
    """Short DB heartbeat transactions, never an open connection during I/O."""
    def __init__(self, engine, *, source_id=None, analysis_id=None, run_id=None):
        self.engine, self.source_id, self.analysis_id = engine, source_id, analysis_id
        self.run_id = run_id
        self.stop, self.lost, self.thread = Event(), Event(), None

    def records(self, db):
        if self.analysis_id is None:
            source = db.scalar(select(Source).where(Source.id == self.source_id).with_for_update())
            return [source] if source else []
        source_id = db.scalar(select(Analysis.source_id).where(Analysis.id == self.analysis_id))
        if source_id is None:
            return []
        source = db.scalar(select(Source).where(Source.id == source_id).with_for_update())
        analysis = db.scalar(select(Analysis).where(Analysis.id == self.analysis_id).with_for_update())
        if not source or not analysis or source.user_id != analysis.user_id:
            return []
        return [source, analysis] if source.source_type in {"image", "pdf"} else [analysis]

    def owns(self, record):
        return bool(not self.lost.is_set() and is_processing(record)
                    and record.processing_run_id == self.run_id and record.processing_lease_until
                    and aware(record.processing_lease_until) > now())

    def start(self):
        with Session(self.engine) as db:
            records = self.records(db)
            if not records or not all(is_processing(r) for r in records):
                return False
            self.run_id = self.run_id or records[-1].processing_run_id or uuid.uuid4()
            for record in records:
                if record.processing_run_id is not None and not self.owns(record):
                    return False
                begin_processing(record, self.run_id)
            db.commit()
        self.thread = Thread(target=self._heartbeat, name="processing-lease", daemon=True)
        self.thread.start()
        return True

    def renew(self):
        with Session(self.engine) as db:
            if self.engine.dialect.name == "postgresql":
                db.execute(text("SET LOCAL lock_timeout = '2000ms'"))
            records = self.records(db)
            if not records or not all(self.owns(r) for r in records):
                self.lost.set()
                return False
            for record in records:
                begin_processing(record, self.run_id)
            db.commit()
        return True

    def _heartbeat(self):
        while not self.stop.wait(HEARTBEAT_SECONDS):
            try:
                if not self.renew():
                    return
            except Exception as error:  # noqa: BLE001 - expiry still fences failed renewals.
                logger.warning("Processing heartbeat unavailable: %s", type(error).__name__)

    def close(self):
        self.stop.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3)


def expired(model, at):
    return or_(model.processing_lease_until <= at,
               and_(model.processing_lease_until.is_(None),
                    model.updated_at <= at - timedelta(seconds=LEGACY_GRACE_SECONDS)))


def recover_interrupted(engine, *, at=None, limit=50):
    """Bounded, parent-first locks; healthy workers on other servers stay alive."""
    at = at or now()
    counts = {"sources": 0, "analyses": 0}
    with Session(engine) as db:
        sources = db.scalars(select(Source).where(Source.processing_status == "processing", expired(Source, at))
                            .order_by(Source.updated_at, Source.id).limit(limit).with_for_update(skip_locked=True)).all()
        for source in sources:
            token = source.processing_run_id
            analyses = []
            if source.source_type in {"image", "pdf"}:
                analyses = db.scalars(select(Analysis).where(Analysis.source_id == source.id,
                    Analysis.status == "processing", Analysis.processing_run_id == token).with_for_update()).all()
                for analysis in analyses:
                    interrupt(analysis)
                    counts["analyses"] += 1
            interrupt_file_source(source, analyses)
            counts["sources"] += 1
        # Query IDs without child locks, then lock each source before its analysis.
        rows = db.execute(select(Analysis.id, Analysis.source_id).where(
            Analysis.status == "processing", expired(Analysis, at)).order_by(Analysis.updated_at, Analysis.id).limit(limit)).all()
        for identity, source_id in rows:
            source = db.scalar(select(Source).where(Source.id == source_id).with_for_update(skip_locked=True))
            if source is None:
                continue
            analysis = db.scalar(select(Analysis).where(Analysis.id == identity,
                Analysis.status == "processing", expired(Analysis, at)).with_for_update(skip_locked=True))
            if analysis is None:
                continue
            token = analysis.processing_run_id
            interrupt(analysis)
            counts["analyses"] += 1
            if source.source_type in {"image", "pdf"} and is_processing(source) and source.processing_run_id == token:
                interrupt_file_source(source, [analysis])
                counts["sources"] += 1
        db.commit()
    return counts
