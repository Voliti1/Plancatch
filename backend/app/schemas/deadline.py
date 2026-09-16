"""Deadline API schemas."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class DeadlineCreate(BaseModel):
    """Fields accepted when a user creates a deadline."""

    source_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=255)
    due_at: AwareDatetime
    deadline_type: str | None = Field(default=None, max_length=50)
    description: str | None = None
    confidence: Decimal | None = Field(default=None, ge=0, le=1)
    evidence_text: str | None = None
    is_confirmed: bool = False


class DeadlineUpdate(BaseModel):
    """Editable deadline fields."""

    source_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    due_at: AwareDatetime | None = None
    deadline_type: str | None = Field(default=None, max_length=50)
    description: str | None = None
    confidence: Decimal | None = Field(default=None, ge=0, le=1)
    evidence_text: str | None = None
    is_confirmed: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "DeadlineUpdate":
        """Do not allow required database fields to be cleared."""
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("title cannot be null")
        if "due_at" in self.model_fields_set and self.due_at is None:
            raise ValueError("due_at cannot be null")
        if "is_confirmed" in self.model_fields_set and self.is_confirmed is None:
            raise ValueError("is_confirmed cannot be null")
        return self


class DeadlineResponse(BaseModel):
    """Deadline data returned to its owner."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID | None
    title: str
    due_at: datetime
    deadline_type: str | None
    description: str | None
    confidence: Decimal | None
    evidence_text: str | None
    is_confirmed: bool
    created_at: datetime
    updated_at: datetime
