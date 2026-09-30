"""Deadline API schemas."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.services.deadline_safety import calculate_safe_due_at


class DeadlineTimes(BaseModel):
    """Normalize writes before persistence and reject client-supplied derived fields."""

    model_config = ConfigDict(extra="forbid")

    @field_validator("due_at", check_fields=False)
    @classmethod
    def normalize_utc(cls, value: datetime | None) -> datetime | None:
        try:
            return value.astimezone(UTC) if value is not None else None
        except OverflowError as exc:
            raise ValueError("due_at is outside the supported UTC date range") from exc


class DeadlineCreate(DeadlineTimes):
    """Fields accepted when a user creates a deadline."""

    source_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=255)
    due_at: AwareDatetime
    safety_buffer_minutes: int | None = Field(default=None, strict=True, gt=0, le=2147483647)
    deadline_type: str | None = Field(default=None, max_length=50)
    description: str | None = None
    confidence: Decimal | None = Field(default=None, ge=0, le=1)
    evidence_text: str | None = None
    is_confirmed: bool = False

    @model_validator(mode="after")
    def validate_safety_deadline(self) -> "DeadlineCreate":
        calculate_safe_due_at(self.due_at, self.safety_buffer_minutes)
        return self


class DeadlineUpdate(DeadlineTimes):
    """Editable deadline fields."""

    source_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    due_at: AwareDatetime | None = None
    safety_buffer_minutes: int | None = Field(default=None, strict=True, gt=0, le=2147483647)
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
    safety_buffer_minutes: int | None
    safe_due_at: datetime | None
    deadline_type: str | None
    description: str | None
    confidence: Decimal | None
    evidence_text: str | None
    is_confirmed: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("due_at")
    @classmethod
    def normalize_due_at(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
