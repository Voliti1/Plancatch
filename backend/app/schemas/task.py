"""Task input validation and public responses."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

ScheduleType = Literal["fixed", "flexible"]


class TaskCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    deadline_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    estimated_minutes: int | None = Field(default=None, gt=0)
    priority: int = Field(default=3, ge=1, le=5)
    schedule_type: ScheduleType = "flexible"
    earliest_start: AwareDatetime | None = None
    latest_end: AwareDatetime | None = None
    is_completed: bool = False

    @model_validator(mode="after")
    def validate_window(self) -> "TaskCreate":
        if (
            self.earliest_start is not None
            and self.latest_end is not None
            and self.earliest_start >= self.latest_end
        ):
            raise ValueError("latest_end must be after earliest_start")
        return self


class TaskUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    deadline_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    estimated_minutes: int | None = Field(default=None, gt=0)
    priority: int | None = Field(default=None, ge=1, le=5)
    schedule_type: ScheduleType | None = None
    earliest_start: AwareDatetime | None = None
    latest_end: AwareDatetime | None = None
    is_completed: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "TaskUpdate":
        for field in ("title", "priority", "schedule_type", "is_completed"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    deadline_id: uuid.UUID | None
    title: str
    description: str | None
    estimated_minutes: int | None
    priority: int
    schedule_type: ScheduleType
    earliest_start: datetime | None
    latest_end: datetime | None
    is_completed: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
