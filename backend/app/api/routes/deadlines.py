"""Authenticated deadline CRUD endpoints."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models.analysis import Analysis
from app.models.deadline import Deadline
from app.models.source import Source
from app.schemas.deadline import DeadlineCreate, DeadlineResponse, DeadlineUpdate
from app.services.deadline_safety import calculate_safe_due_at

router = APIRouter(prefix="/api/deadlines", tags=["deadlines"])


def get_owned_deadline(
    deadline_id: uuid.UUID,
    user_id: uuid.UUID,
    db: DatabaseSession,
    *,
    for_update: bool = False,
) -> Deadline:
    """Return an owned deadline without revealing other users' records."""
    statement = select(Deadline).where(
        Deadline.id == deadline_id,
        Deadline.user_id == user_id,
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    deadline = db.scalar(statement)
    if deadline is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Deadline not found",
        )
    return deadline


def validate_owned_source(
    source_id: uuid.UUID | None,
    user_id: uuid.UUID,
    db: DatabaseSession,
) -> None:
    """Ensure an optional source belongs to the authenticated user."""
    if source_id is None:
        return
    owned_source_id = db.scalar(
        select(Source.id).where(
            Source.id == source_id,
            Source.user_id == user_id,
        ).with_for_update(),
    )
    if owned_source_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )


def lock_deadline_and_sources(
    deadline_id: uuid.UUID, user_id: uuid.UUID, db: DatabaseSession,
    new_source_id: uuid.UUID | None = None,
) -> tuple[Deadline, Source | None]:
    """Lock parents before the child, like approval and direct source deletion."""
    source_id = get_owned_deadline(deadline_id, user_id, db).source_id
    sources = {}
    for identity in sorted({value for value in (source_id, new_source_id) if value}, key=str):
        source = db.scalar(select(Source).where(Source.id == identity, Source.user_id == user_id)
                           .with_for_update())
        if identity == new_source_id and source is None:
            raise HTTPException(status_code=404, detail="Source not found")
        sources[identity] = source
    deadline = get_owned_deadline(deadline_id, user_id, db, for_update=True)
    if deadline.source_id != source_id:
        raise HTTPException(status_code=409, detail="deadline_source_changed")
    return deadline, sources.get(source_id)


@router.post("", response_model=DeadlineResponse, status_code=status.HTTP_201_CREATED)
def create_deadline(
    payload: DeadlineCreate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Deadline:
    """Create a deadline, optionally linked to an owned source."""
    validate_owned_source(payload.source_id, current_user.id, db)
    deadline = Deadline(user_id=current_user.id, **payload.model_dump())
    db.add(deadline)
    db.commit()
    db.refresh(deadline)
    return deadline


@router.get("", response_model=list[DeadlineResponse])
def list_deadlines(
    current_user: CurrentUser,
    db: DatabaseSession,
    is_confirmed: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str, Query(max_length=255)] = "",
) -> list[Deadline]:
    """List owned deadlines in chronological order."""
    statement = select(Deadline).where(Deadline.user_id == current_user.id)
    if query := q.strip():
        statement = statement.where(Deadline.title.icontains(query, autoescape=True))
    if is_confirmed is not None:
        statement = statement.where(Deadline.is_confirmed == is_confirmed)

    return list(
        db.scalars(
            statement.order_by(Deadline.due_at.asc(), Deadline.id).limit(limit).offset(offset),
        ),
    )


@router.get("/{deadline_id}", response_model=DeadlineResponse)
def read_deadline(
    deadline_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Deadline:
    """Return one deadline owned by the authenticated user."""
    return get_owned_deadline(deadline_id, current_user.id, db)


@router.patch("/{deadline_id}", response_model=DeadlineResponse)
def update_deadline(
    deadline_id: uuid.UUID,
    payload: DeadlineUpdate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Deadline:
    """Update an owned deadline."""
    changes = payload.model_dump(exclude_unset=True)
    deadline, _ = lock_deadline_and_sources(deadline_id, current_user.id, db, changes.get("source_id"))

    # Validate the combined saved + patched values before changing any database field.
    try:
        calculate_safe_due_at(
            changes.get("due_at", deadline.due_at),
            changes.get("safety_buffer_minutes", deadline.safety_buffer_minutes),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    for field, value in changes.items():
        setattr(deadline, field, value)

    db.commit()
    db.refresh(deadline)
    return deadline


@router.delete("/{deadline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deadline(
    deadline_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Response:
    """Delete the owned deadline and its now-unreferenced owned source atomically."""
    deadline, source = lock_deadline_and_sources(deadline_id, current_user.id, db)
    remove_source = source is not None and db.scalar(select(Deadline.id).where(
        Deadline.source_id == source.id, Deadline.id != deadline.id,
    ).limit(1)) is None
    if remove_source and (source.processing_status == "processing" or db.scalar(select(Analysis.id).where(
            Analysis.source_id == source.id, Analysis.status == "processing",
    ).limit(1)) is not None):
        raise HTTPException(status_code=409, detail="deadline_source_busy")
    image_key = source.storage_key if remove_source and source.source_type == "image" else None
    db.delete(deadline)
    db.flush()
    if remove_source:
        db.delete(source)
    db.commit()
    if image_key:
        from app.services.source_images import remove_image
        remove_image(image_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
