"""Authenticated deadline CRUD endpoints."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models.deadline import Deadline
from app.models.source import Source
from app.schemas.deadline import DeadlineCreate, DeadlineResponse, DeadlineUpdate

router = APIRouter(prefix="/api/deadlines", tags=["deadlines"])


def get_owned_deadline(
    deadline_id: uuid.UUID,
    user_id: uuid.UUID,
    db: DatabaseSession,
) -> Deadline:
    """Return an owned deadline without revealing other users' records."""
    deadline = db.scalar(
        select(Deadline).where(
            Deadline.id == deadline_id,
            Deadline.user_id == user_id,
        ),
    )
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
        ),
    )
    if owned_source_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )


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
) -> list[Deadline]:
    """List owned deadlines in chronological order."""
    statement = select(Deadline).where(Deadline.user_id == current_user.id)
    if is_confirmed is not None:
        statement = statement.where(Deadline.is_confirmed == is_confirmed)

    return list(
        db.scalars(
            statement.order_by(Deadline.due_at.asc()).limit(limit).offset(offset),
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
    deadline = get_owned_deadline(deadline_id, current_user.id, db)
    changes = payload.model_dump(exclude_unset=True)
    if "source_id" in changes:
        validate_owned_source(changes["source_id"], current_user.id, db)

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
    """Delete one deadline owned by the authenticated user."""
    deadline = get_owned_deadline(deadline_id, current_user.id, db)
    db.delete(deadline)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
