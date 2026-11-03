"""Private image/PDF uploads. File analysis requires separate consent."""
import hashlib
import uuid
from threading import BoundedSemaphore
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from sqlalchemy import case, select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.sources import get_owned_source
from app.models.analysis import Analysis
from app.models.source import Source
from app.schemas.analysis import AnalysisRequest
from app.schemas.source import SourceResponse
from app.services.ai_analysis import AIError, configured_model, slots
from app.services.file_source_metadata import (
    filename_label,
    lock_file_owner,
    metadata_key,
    reusable_files,
    reusable_review,
)
from app.services.image_analysis import process_file_analysis
from app.services.pdf_analysis import LOCAL_MODEL, SCAN_CONSENT_REQUIRED
from app.services.source_images import (
    MAX_BYTES,
    file_hash,
    normalize_image,
    read_file,
    remove_file,
    store_file,
    validate_pdf,
)

router = APIRouter(prefix="/api/sources", tags=["source-images"])
upload_slots = BoundedSemaphore(1)


@router.post("/images", response_model=SourceResponse, status_code=201)
def upload_image(current_user: CurrentUser, db: DatabaseSession,
                 file: Annotated[UploadFile, File()],
                 title: Annotated[str, Form(max_length=255)] = "") -> Source:
    return upload_file(current_user, db, file, title, "image")


@router.post("/pdfs", response_model=SourceResponse, status_code=201)
def upload_pdf(current_user: CurrentUser, db: DatabaseSession,
               file: Annotated[UploadFile, File()],
               title: Annotated[str, Form(max_length=255)] = "") -> Source:
    return upload_file(current_user, db, file, title, "pdf")


def upload_file(current_user, db, file: UploadFile, title: str, source_type: str) -> Source:
    filename = filename_label(file.filename, "자료.pdf" if source_type == "pdf" else "이미지.png")
    if not upload_slots.acquire(blocking=False):
        file.file.close()
        raise HTTPException(429, "Image upload capacity reached; retry later")
    try:
        data = file.file.read(MAX_BYTES + 1)
        data = validate_pdf(data) if source_type == "pdf" else normalize_image(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        file.file.close()
        upload_slots.release()
    entered_title = title.strip()
    lock_file_owner(db, current_user.id)
    digest = hashlib.sha256(data).hexdigest()
    for existing in reusable_files(db, current_user.id, source_type, filename):
        if (metadata_key(existing.file_metadata) and file_hash(existing.storage_key, source_type) == digest
                and (not entered_title or entered_title == existing.title) and reusable_review(db, existing)):
            try:
                read_file(existing.storage_key, source_type)
            except (OSError, ValueError, TypeError):
                continue
            return existing
    key = store_file(data, source_type)
    source = Source(user_id=current_user.id, source_type=source_type, title=entered_title or filename,
                    original_filename=filename, file_metadata={"title_entered": bool(entered_title)}, storage_key=key)
    try:
        db.add(source)
        db.commit()
        db.refresh(source)
    except Exception:
        db.rollback()
        remove_file(key)
        raise
    return source


@router.get("/{source_id}/image")
def preview_image(source_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Response:
    source = get_owned_source(source_id, current_user.id, db, for_update=False)
    if source.source_type != "image":
        raise HTTPException(404, "Image not found")
    try:
        data = read_file(source.storage_key, "image")
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(404, "Image not found") from exc
    return Response(data, media_type="image/png", headers={"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"})


def start_file_analysis(source: Source, payload: AnalysisRequest, db: DatabaseSession,
                        background_tasks: BackgroundTasks) -> Analysis:
    digest = file_hash(source.storage_key, source.source_type)
    prefix = f"{source.source_type}:"
    if not digest or payload.input_hash != digest:
        raise HTTPException(409, "Source changed; confirm the source again")
    if source.source_type == "image" and not payload.allow_external_ai:
        raise HTTPException(422, "External AI consent is required for file analysis")
    if payload.reuse_existing:
        existing = db.scalar(select(Analysis).where(Analysis.source_id == source.id,
            Analysis.user_id == source.user_id, Analysis.input_hash == digest,
            Analysis.reused_analysis_id.is_(None),
            Analysis.model.startswith(prefix)).order_by(
                Analysis.created_at.desc(), case((Analysis.error_message == SCAN_CONSENT_REQUIRED, 1), else_=0),
                Analysis.id.desc(),
            ).limit(1))
        if existing is not None:
            return existing
    if db.scalar(select(Analysis.id).where(Analysis.source_id == source.id,
                                           Analysis.status == "processing")) is not None:
        raise HTTPException(409, "Source analysis is already processing")
    try:
        model = LOCAL_MODEL if source.source_type == "pdf" else prefix + configured_model()
        read_file(source.storage_key, source.source_type)
    except AIError as exc:
        raise HTTPException(503, str(exc)) from exc
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(409, "Saved file is unavailable") from exc
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "AI capacity reached; retry later")
    try:
        analysis = Analysis(user_id=source.user_id, source_id=source.id,
            input_text="파일 분석 준비 중", input_hash=digest, model=model)
        source.processing_status = "processing"
        source.error_message = None
        db.add(analysis)
        db.commit()
        db.refresh(analysis)
        background_tasks.add_task(process_file_analysis, analysis.id, db.get_bind(), payload.allow_external_ai)
        return analysis
    except Exception:
        db.rollback()
        slots.release()
        raise
