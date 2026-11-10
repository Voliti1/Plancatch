"""Task input validation and public responses."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.schemas.google_reminders import GoogleReminders, default_reminders
from app.schemas.recurrence import Recurrence
from app.services.recurrence import validate as validate_recurrence

ScheduleType = Literal["fixed", "flexible"]


class TaskTimes(BaseModel):
    @field_validator("earliest_start", "latest_end", check_fields=False)
    @classmethod
    def normalize_utc(cls, value: datetime | None) -> datetime | None:
        try:
            return value.astimezone(UTC) if value is not None else None
        except OverflowError as exc:
            raise ValueError("time is outside the supported UTC date range") from exc


class TaskCreate(TaskTimes):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    deadline_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    recurrence: Recurrence | None = None
    google_reminders: GoogleReminders = Field(default_factory=default_reminders)
    estimated_minutes: int | None = Field(default=None, gt=0, le=2147483647)
    priority: int = Field(default=3, ge=1, le=5)
    schedule_type: ScheduleType = "flexible"
    earliest_start: AwareDatetime | None = None
    latest_end: AwareDatetime | None = None
    is_completed: bool = False

    @model_validator(mode="after")
    def validate_window(self) -> "TaskCreate":
        validate_recurrence(self.recurrence, self.schedule_type, self.earliest_start, self.latest_end)
        if (
            self.earliest_start is not None
            and self.latest_end is not None
            and self.earliest_start >= self.latest_end
        ):
            raise ValueError("latest_end must be after earliest_start")
        return self


class TaskUpdate(TaskTimes):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    deadline_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    recurrence: Recurrence | None = None
    google_reminders: GoogleReminders | None = None
    estimated_minutes: int | None = Field(default=None, gt=0, le=2147483647)
    priority: int | None = Field(default=None, ge=1, le=5)
    schedule_type: ScheduleType | None = None
    earliest_start: AwareDatetime | None = None
    latest_end: AwareDatetime | None = None
    is_completed: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "TaskUpdate":
        for field in ("title", "priority", "schedule_type", "is_completed", "google_reminders"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    deadline_id: uuid.UUID | None
    title: str
    description: str | None
    recurrence: Recurrence | None = None
    google_reminders: GoogleReminders | None = None
    estimated_minutes: int | None
    priority: int
    schedule_type: ScheduleType
    earliest_start: datetime | None
    latest_end: datetime | None
    is_completed: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
