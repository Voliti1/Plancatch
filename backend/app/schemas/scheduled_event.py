"""Calendar placement input and response schemas."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator

EditableStatus = Literal["recommended", "approved", "cancelled"]


class ScheduledEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: uuid.UUID
    start_at: AwareDatetime
    end_at: AwareDatetime
    status: EditableStatus = "recommended"

    @model_validator(mode="after")
    def validate_range(self) -> "ScheduledEventCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class ScheduledEventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    status: EditableStatus | None = None

    @model_validator(mode="after")
    def reject_null(self) -> "ScheduledEventUpdate":
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ScheduledEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    status: Literal["recommended", "approved", "synced", "cancelled"]
    is_user_approved: bool
    google_calendar_id: str | None
    google_event_id: str | None
    sync_error: str | None
    created_at: datetime
    updated_at: datetime
