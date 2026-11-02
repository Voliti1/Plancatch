import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ExportKind = Literal["deadline", "task", "event"]


class ExportTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ExportKind
    item_id: uuid.UUID


class ExportConfirmation(ExportTarget):
    preview_token: str = Field(min_length=1, max_length=8192)
    confirm: Literal[True]

    @field_validator("confirm", mode="before")
    @classmethod
    def explicit_true(cls, value):
        if value is not True:
            raise ValueError("Explicit true confirmation is required")
        return value


class ExportPreview(BaseModel):
    title: str
    start_at: datetime
    end_at: datetime
    status: Literal["new", "pending", "sent", "conflict", "blocked"]
    changed: bool
    preview_token: str | None
    note: str


class ExportResult(BaseModel):
    status: Literal["sent"]
    google_event_id: str
    already_sent: bool
