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
    status: Literal["new", "pending", "sent", "conflict", "blocked", "changing", "deleted"]
    changed: bool
    preview_token: str | None
    note: str
    local_available: bool = True
    pending_action: Literal["update", "delete"] | None = None


class ExportResult(BaseModel):
    status: Literal["sent"]
    google_event_id: str
    already_sent: bool


class ChangeTarget(ExportTarget):
    action: Literal["update", "delete"]


class ChangeConfirmation(ExportConfirmation):
    action: Literal["update", "delete"]


class ChangeSnapshot(BaseModel):
    title: str
    start_at: datetime
    end_at: datetime


class ChangePreview(BaseModel):
    action: Literal["update", "delete"]
    before: ChangeSnapshot
    after: ChangeSnapshot | None
    state: Literal["ready", "pending", "unchanged", "deleted"]
    preview_token: str | None
    note: str


class ChangeResult(BaseModel):
    action: Literal["update", "delete"]
    state: Literal["applied"] = "applied"
    already_applied: bool
