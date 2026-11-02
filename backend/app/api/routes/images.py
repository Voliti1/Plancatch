"""Owned bounded image upload/preview; external analysis requires separate consent."""
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
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.sources import get_owned_source
from app.models.analysis import Analysis
from app.models.source import Source
from app.schemas.analysis import AnalysisRequest
from app.schemas.source import SourceResponse
from app.services.ai_analysis import AIError, configured_model, slots
from app.services.image_analysis import PREFIX, process_image_analysis
from app.services.source_images import (
    MAX_BYTES,
    image_hash,
    normalize_image,
    read_image,
    remove_image,
    store_image,
)

router = APIRouter(prefix="/api/sources", tags=["source-images"])
upload_slots = BoundedSemaphore(1)


@router.post("/images", response_model=SourceResponse, status_code=201)
def upload_image(current_user: CurrentUser, db: DatabaseSession,
                 file: Annotated[UploadFile, File()],
                 title: Annotated[str, Form(max_length=255)] = "") -> Source:
    if not upload_slots.acquire(blocking=False):
        file.file.close()
        raise HTTPException(429, "Image upload capacity reached; retry later")
    try:
        data = normalize_image(file.file.read(MAX_BYTES + 1))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        file.file.close()
        upload_slots.release()
    key = store_image(data)
    source = Source(user_id=current_user.id, source_type="image", title=title.strip() or None,
                    storage_key=key)
    try:
        db.add(source)
        db.commit()
        db.refresh(source)
    except Exception:
        db.rollback()
        remove_image(key)
        raise
    return source


@router.get("/{source_id}/image")
def preview_image(source_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Response:
    source = get_owned_source(source_id, current_user.id, db, for_update=False)
    if source.source_type != "image":
        raise HTTPException(404, "Image not found")
    try:
        data = read_image(source.storage_key)
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(404, "Image not found") from exc
    return Response(data, media_type="image/png", headers={"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"})


def start_image_analysis(source: Source, payload: AnalysisRequest, db: DatabaseSession,
                         background_tasks: BackgroundTasks) -> Analysis:
    digest = image_hash(source.storage_key)
    if not digest or payload.input_hash != digest:
        raise HTTPException(409, "Image changed; confirm the image again")
    if not payload.allow_external_ai:
        raise HTTPException(422, "External AI consent is required for image analysis")
    if payload.reuse_existing:
        existing = db.scalar(select(Analysis).where(Analysis.source_id == source.id,
            Analysis.user_id == source.user_id, Analysis.input_hash == digest,
            Analysis.model.startswith(PREFIX)).order_by(Analysis.created_at.desc()).limit(1))
        if existing is not None:
            return existing
    if db.scalar(select(Analysis.id).where(Analysis.source_id == source.id,
                                           Analysis.status == "processing")) is not None:
        raise HTTPException(409, "Source analysis is already processing")
    try:
        model = configured_model()
        read_image(source.storage_key)
    except AIError as exc:
        raise HTTPException(503, str(exc)) from exc
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(409, "Saved image is unavailable") from exc
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "AI capacity reached; retry later")
    try:
        analysis = Analysis(user_id=source.user_id, source_id=source.id,
            input_text="이미지 분석 준비 중", input_hash=digest, model=PREFIX + model)
        source.processing_status = "processing"
        source.error_message = None
        db.add(analysis)
        db.commit()
        db.refresh(analysis)
        background_tasks.add_task(process_image_analysis, analysis.id, db.get_bind())
        return analysis
    except Exception:
        db.rollback()
        slots.release()
        raise
