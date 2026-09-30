"""Owned, revision-checked AI review; approval creates deadlines atomically."""
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.sources import get_owned_source
from app.models.analysis import Analysis
from app.models.deadline import Deadline
from app.schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    DecisionRequest,
    ReviewRequest,
)
from app.services.ai_analysis import (
    MAX_INPUT,
    AIError,
    configured_model,
    content_hash,
    process_analysis,
    slots,
)

router = APIRouter(tags=["ai-analyses"])


def owned_analysis(analysis_id: uuid.UUID, user_id: uuid.UUID, db: DatabaseSession) -> Analysis:
    analysis = db.scalar(select(Analysis).where(
        Analysis.id == analysis_id, Analysis.user_id == user_id,
    ).with_for_update())
    if analysis is None:
        raise HTTPException(404, "Analysis not found")
    return analysis


def ensure_ready(analysis: Analysis, revision: int) -> None:
    if analysis.status != "ready":
        raise HTTPException(409, "Analysis is not awaiting review")
    if analysis.revision != revision:
        raise HTTPException(409, "Review changed; reload before retrying")


@router.post("/api/sources/{source_id}/ai-analyses", response_model=AnalysisResponse, status_code=202)
def start_analysis(source_id: uuid.UUID, payload: AnalysisRequest,
                   background_tasks: BackgroundTasks, current_user: CurrentUser,
                   db: DatabaseSession) -> Analysis:
    source = get_owned_source(source_id, current_user.id, db)
    if source.processing_status != "extracted" or not source.extracted_text:
        raise HTTPException(409, "Extract source text first")
    if len(source.extracted_text) > MAX_INPUT:
        raise HTTPException(422, "AI input exceeds 40000 characters; split the source")
    if db.scalar(select(Analysis.id).where(Analysis.source_id == source.id,
                                         Analysis.status == "processing")) is not None:
        raise HTTPException(409, "Source analysis is already processing")
    try:
        model = configured_model()
    except AIError as exc:
        raise HTTPException(503, str(exc)) from exc
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "AI capacity reached; retry later")
    try:
        analysis = Analysis(user_id=current_user.id, source_id=source.id,
                            input_text=source.extracted_text,
                            input_hash=content_hash(source.extracted_text), model=model)
        db.add(analysis)
        db.commit()
        db.refresh(analysis)
        background_tasks.add_task(process_analysis, analysis.id, db.get_bind())
    except IntegrityError as exc:
        db.rollback()
        slots.release()
        raise HTTPException(409, "Source analysis is already processing") from exc
    except Exception:
        db.rollback()
        slots.release()
        raise
    return analysis


@router.get("/api/sources/{source_id}/ai-analyses", response_model=list[AnalysisResponse])
def list_analyses(source_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession,
                  limit: Annotated[int, Query(ge=1, le=30)] = 10,
                  offset: Annotated[int, Query(ge=0)] = 0) -> list[Analysis]:
    get_owned_source(source_id, current_user.id, db)
    return list(db.scalars(select(Analysis).where(
        Analysis.source_id == source_id, Analysis.user_id == current_user.id,
    ).order_by(Analysis.created_at.desc(), Analysis.id).limit(limit).offset(offset)))


@router.get("/api/ai-analyses/{analysis_id}", response_model=AnalysisResponse)
def read_analysis(analysis_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession) -> Analysis:
    return owned_analysis(analysis_id, current_user.id, db)


@router.patch("/api/ai-analyses/{analysis_id}", response_model=AnalysisResponse)
def review_analysis(analysis_id: uuid.UUID, payload: ReviewRequest,
                    current_user: CurrentUser, db: DatabaseSession) -> Analysis:
    analysis = owned_analysis(analysis_id, current_user.id, db)
    ensure_ready(analysis, payload.revision)
    originals = {item["id"]: item for item in analysis.candidates}
    if {str(item.id) for item in payload.candidates} != set(originals):
        raise HTTPException(422, "Include all candidate IDs; use selected=false to exclude")
    analysis.candidates = [dict(originals[str(item.id)], **item.model_dump(mode="json"))
                           for item in payload.candidates]
    analysis.revision += 1
    db.commit()
    db.refresh(analysis)
    return analysis


@router.post("/api/ai-analyses/{analysis_id}/approve", response_model=AnalysisResponse)
def approve_analysis(analysis_id: uuid.UUID, payload: DecisionRequest,
                     current_user: CurrentUser, db: DatabaseSession) -> Analysis:
    analysis = owned_analysis(analysis_id, current_user.id, db)
    if analysis.status == "approved":
        return analysis  # Idempotent retry; no duplicate deadlines.
    ensure_ready(analysis, payload.revision)
    source = get_owned_source(analysis.source_id, current_user.id, db)
    if (source.processing_status != "extracted" or not source.extracted_text
            or content_hash(source.extracted_text) != analysis.input_hash):
        raise HTTPException(409, "Source changed; extract and analyze it again")
    selected = [item for item in analysis.candidates if item["selected"]]
    if not selected or any(item["due_at"] is None for item in selected):
        raise HTTPException(422, "Select at least one candidate with an explicit deadline")
    ids = []
    for item in selected:
        deadline = Deadline(user_id=current_user.id, source_id=source.id,
                            title=item["title"], due_at=datetime.fromisoformat(item["due_at"]),
                            description=item["description"], confidence=item["confidence"],
                            evidence_text=item["evidence_text"], is_confirmed=True)
        db.add(deadline)
        db.flush()
        ids.append(str(deadline.id))
    analysis.approved_deadline_ids = ids
    analysis.status = "approved"
    db.commit()
    db.refresh(analysis)
    return analysis


@router.post("/api/ai-analyses/{analysis_id}/reject", response_model=AnalysisResponse)
def reject_analysis(analysis_id: uuid.UUID, payload: DecisionRequest,
                    current_user: CurrentUser, db: DatabaseSession) -> Analysis:
    analysis = owned_analysis(analysis_id, current_user.id, db)
    ensure_ready(analysis, payload.revision)
    analysis.status = "rejected"
    db.commit()
    db.refresh(analysis)
    return analysis
