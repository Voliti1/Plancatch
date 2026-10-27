"""Bounded extraction without holding a database connection during network I/O."""

import logging
import uuid
from threading import BoundedSemaphore

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models.source import Source
from app.services.extraction import ExtractionError, extract

slots = BoundedSemaphore(2)
logger = logging.getLogger(__name__)


def process_source(source_id: uuid.UUID, engine: Engine) -> None:
    try:
        with Session(engine) as db:
            source = db.get(Source, source_id)
            if source is None or source.processing_status != "processing":
                return
            snapshot = (source.source_type, source.original_url, source.original_text)
        document = None
        try:
            document = extract(*snapshot)
            state, reason = "extracted", None
        except ExtractionError as exc:
            reason = str(exc)
            state = "requires_login" if reason == "requires_login" else "failed"
        except Exception:  # noqa: BLE001 -- persist a safe failure for any worker error
            # Do not expose page contents, database credentials or exception messages.
            logger.error("Source extraction failed for %s", source_id)
            state, reason = "failed", "extraction_failed"
        with Session(engine) as db:
            source = db.scalar(select(Source).where(Source.id == source_id).with_for_update())
            if (source is None or source.processing_status != "processing"
                    or (source.source_type, source.original_url, source.original_text) != snapshot):
                return
            if document is not None:
                source.extracted_text = document.text
                if not source.title and document.title:
                    source.title = document.title
            source.processing_status, source.error_message = state, reason
            db.commit()
    finally:
        slots.release()
