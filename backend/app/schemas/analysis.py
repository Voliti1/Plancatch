"""Explicit review and consent contracts; no AI result is approved automatically."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=255)
    due_at: AwareDatetime | None = None
    description: str | None = Field(default=None, max_length=2000)
    evidence_text: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(ge=0, le=1)

    @field_validator("title", "evidence_text")
    @classmethod
    def strip_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Field must not be blank")
        return value.strip()


class ProviderResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deadlines: list[Proposal] = Field(max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("warnings")
    @classmethod
    def bounded_warnings(cls, values: list[str]) -> list[str]:
        if any(len(value) > 1000 for value in values):
            raise ValueError("Warning too long")
        return values


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allow_external_ai: Literal[True]


class Candidate(Proposal):
    id: uuid.UUID
    selected: bool


class CandidateEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    title: str = Field(min_length=1, max_length=255)
    due_at: AwareDatetime | None
    description: str | None = Field(default=None, max_length=2000)
    selected: bool

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title must not be blank")
        return value.strip()


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    candidates: list[CandidateEdit] = Field(max_length=30)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({item.id for item in self.candidates}) != len(self.candidates):
            raise ValueError("Candidate IDs must be unique")
        return self


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_id: uuid.UUID
    input_text: str
    model: str
    status: str
    revision: int
    candidates: list[Candidate]
    warnings: list[str]
    approved_deadline_ids: list[uuid.UUID]
    error_message: str | None
    created_at: datetime
    updated_at: datetime
