"""Explicit review and opt-in automatic registration contracts."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.services.saramin_period import read_period


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
    allow_external_ai: bool = Field(default=False, strict=True)
    input_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    reuse_existing: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def require_snapshot_for_reuse(self) -> "AnalysisRequest":
        if self.reuse_existing and self.input_hash is None:
            raise ValueError("input_hash is required to reuse a source review")
        return self


class DateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    raw_text: str = Field(min_length=1, max_length=100)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    due_at: AwareDatetime | None = None
    evidence_text: str = Field(min_length=1, max_length=500)
    time_defaulted: bool = False


class Candidate(Proposal):
    id: uuid.UUID
    selected: bool
    time_defaulted: bool = False
    suggested_due_at: AwareDatetime | None = None


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


class AutoRegistrationRequest(DecisionRequest):
    title: str = Field(min_length=1, max_length=255)
    confirm_auto_registration: Literal[True]

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title must not be blank")
        return value.strip()


class SourcePeriod(BaseModel):
    site: Literal["saramin", "jobkorea", "catch", "jobplanet", "jasoseol", "linkareer", "work24"] = "saramin"
    start_text: str | None
    end_text: str | None
    deadline_at: AwareDatetime | None
    remaining_text: str | None
    has_conflict: bool
    time_defaulted: bool = False


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_id: uuid.UUID
    input_text: str
    input_hash: str = ""
    model: str
    status: str
    revision: int
    candidates: list[Candidate]
    warnings: list[str]
    approved_deadline_ids: list[uuid.UUID]
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def explain_clocks(self):
        from app.services.deadline_dates import closing_choice, resolved_warnings
        from app.services.url_deadlines import review_data
        data = review_data(self.input_text) if self.model.startswith("html:") else None
        safe_url = bool(data and data.get("scope_confirmed") and not data.get("has_conflict")
                        and not data.get("open_ended") and len(data["choices"]) == 1)
        defaulted = False
        for item in self.candidates:
            position = self.input_text.find(item.evidence_text)
            context = self.input_text[max(0, position - 100):position + len(item.evidence_text) + 100]
            choice = (data["choices"][0] if safe_url else None) if self.model.startswith("html:") else (
                closing_choice(item.evidence_text, context) if item.evidence_text in self.input_text else None)
            if not choice or not choice["due_at"]:
                continue
            expected = datetime.fromisoformat(choice["due_at"])
            if item.due_at == expected:
                item.time_defaulted = choice.get("time_defaulted", False)
            elif item.due_at is None and self.status == "ready" and self.revision == 1:
                # Read-only hint for old saved reviews. PATCH + explicit approval
                # still persist the chosen value; GET never edits the DB or calls AI.
                item.suggested_due_at = expected
                item.time_defaulted = choice.get("time_defaulted", False)
            defaulted |= item.time_defaulted
        resolved = bool(self.candidates) and all(item.due_at or item.suggested_due_at for item in self.candidates)
        self.warnings = resolved_warnings(self.warnings, defaulted, resolved)
        return self

    @computed_field
    @property
    def date_choices(self) -> list[DateChoice]:
        if self.model.startswith("image:"):
            from app.services.image_analysis import closing_choice
            choices = [closing_choice(item.evidence_text) for item in self.candidates]
            return [DateChoice(**item) for item in choices if item]
        from app.services.url_deadlines import review_data
        data = review_data(self.input_text)
        return [DateChoice(**item) for item in data["choices"]] if data else []

    @computed_field
    @property
    def is_open_ended(self) -> bool:
        from app.services.url_deadlines import review_data
        data = review_data(self.input_text)
        return bool(data and data.get("open_ended"))

    @computed_field
    @property
    def source_period(self) -> SourcePeriod | None:
        from app.services.catch_period import read_period as read_catch
        from app.services.jasoseol_period import read_period as read_jasoseol
        from app.services.jobkorea_period import read_period as read_jobkorea
        from app.services.jobplanet_period import read_period as read_jobplanet
        from app.services.linkareer_period import read_period as read_linkareer
        from app.services.work24_period import read_period as read_work24
        period = (read_work24(self.input_text) or read_linkareer(self.input_text) or read_jasoseol(self.input_text) or read_jobplanet(self.input_text) or read_catch(self.input_text)
                  or read_jobkorea(self.input_text)) if self.model.startswith("html:") else None
        period = period or read_period(self.input_text)
        if period and not period["deadline_at"] and not period["has_conflict"]:
            from app.services.url_deadlines import review_data
            data = review_data(self.input_text)
            if (data and data.get("scope_confirmed") and not data.get("has_conflict")
                    and not data.get("open_ended") and len(data["choices"]) == 1):
                choice = data["choices"][0]
                if choice.get("time_defaulted") and choice["due_at"]:
                    period = dict(period, deadline_at=choice["due_at"], time_defaulted=True)
        return SourcePeriod(**period) if period else None
