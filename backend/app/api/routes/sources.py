"""Authenticated source-material CRUD endpoints."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models.source import Source
from app.schemas.source import SourceCreate, SourceResponse, SourceUpdate

router = APIRouter(prefix="/api/sources", tags=["sources"])


def get_owned_source(source_id: uuid.UUID, user_id: uuid.UUID, db: DatabaseSession) -> Source:
    """Return a source owned by a user without leaking other users' records."""
    source = db.scalar(
        select(Source).where(Source.id == source_id, Source.user_id == user_id),
    )
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )
    return source


@router.post("", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
def create_source(
    payload: SourceCreate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Source:
    """Create URL or text source material for the authenticated user."""
    source = Source(
        user_id=current_user.id,
        source_type=payload.source_type,
        title=payload.title,
        original_url=str(payload.original_url) if payload.original_url else None,
        original_text=payload.original_text,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.get("", response_model=list[SourceResponse])
def list_sources(
    current_user: CurrentUser,
    db: DatabaseSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Source]:
    """List the authenticated user's source material, newest first."""
    return list(
        db.scalars(
            select(Source)
            .where(Source.user_id == current_user.id)
            .order_by(Source.created_at.desc(), Source.id)
            .limit(limit)
            .offset(offset),
        ),
    )


@router.get("/{source_id}", response_model=SourceResponse)
def read_source(
    source_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Source:
    """Return one source owned by the authenticated user."""
    return get_owned_source(source_id, current_user.id, db)


@router.patch("/{source_id}", response_model=SourceResponse)
def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Source:
    """Update editable fields on an owned source."""
    source = get_owned_source(source_id, current_user.id, db)
    changes = payload.model_dump(exclude_unset=True)

    try:
        candidate = SourceCreate(
            source_type=source.source_type,
            title=changes.get("title", source.title),
            original_url=changes.get("original_url", source.original_url),
            original_text=changes.get("original_text", source.original_text),
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail="Source content is required for its source type",
        ) from exc

    for field in changes:
        value = getattr(candidate, field)
        if field == "original_url" and value is not None:
            value = str(value)
        setattr(source, field, value)

    db.commit()
    db.refresh(source)
    return source


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    source_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Response:
    """Delete one source owned by the authenticated user."""
    source = get_owned_source(source_id, current_user.id, db)
    db.delete(source)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
