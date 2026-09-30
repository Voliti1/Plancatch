"""Small-process background extraction, separate from the future AI stage."""

import logging
import uuid
from threading import BoundedSemaphore

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
            try:
                document = extract(source.source_type, source.original_url, source.original_text)
                source.extracted_text = document.text
                if not source.title and document.title:
                    source.title = document.title
                source.processing_status = "extracted"
                source.error_message = None
            except ExtractionError as exc:
                reason = str(exc)
                source.processing_status = "requires_login" if reason == "requires_login" else "failed"
                source.error_message = reason
            except Exception:  # noqa: BLE001 -- persist a safe failure for any worker error
                # Do not expose page contents, database credentials or exception messages.
                logger.error("Source extraction failed for %s", source_id)
                source.processing_status = "failed"
                source.error_message = "extraction_failed"
            db.commit()
    finally:
        slots.release()
