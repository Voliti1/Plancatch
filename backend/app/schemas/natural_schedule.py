"""Ephemeral natural-language drafts; creation uses the existing reviewed CRUD APIs."""
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.schemas.recurrence import Recurrence


class NaturalScheduleRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    text: str = Field(min_length=1, max_length=1000)


class NaturalScheduleDraft(BaseModel):
    kind: Literal["task", "deadline"]
    title: str
    start_at: AwareDatetime | None
    end_at: AwareDatetime | None
    reference_at: AwareDatetime
    timezone: Literal["Asia/Seoul"] = "Asia/Seoul"
    notices: list[str]
    recurrence: Recurrence | None = None
