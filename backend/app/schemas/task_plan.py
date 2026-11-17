import uuid
from datetime import UTC

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


def validate_graph(mapping):
    pending = {key: set(parents) for key, parents in mapping.items()}
    if any(key in parents or parents - pending.keys() for key, parents in pending.items()):
        raise ValueError("먼저 할 작업을 다시 확인해 주세요.")
    while pending:
        ready = {key for key, parents in pending.items() if not parents}
        if not ready:
            raise ValueError("작업 순서가 서로 맞물려 있습니다. 먼저 할 작업을 다시 정해 주세요.")
        pending = {key: parents - ready for key, parents in pending.items() if key not in ready}


class GeneratePlan(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: uuid.UUID
    allow_external_ai: bool = Field(default=False, strict=True)
    notes: str = Field(default="", max_length=4000)


class ProposedWork(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    key: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(max_length=2000)
    estimated_minutes: int = Field(strict=True, ge=5, le=1440)
    priority: int = Field(strict=True, ge=1, le=5)
    days_before_deadline: int = Field(strict=True, ge=0, le=365)
    depends_on: list[str] = Field(max_length=19)


class ProviderPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tasks: list[ProposedWork] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def graph(self):
        if len({t.key for t in self.tasks}) != len(self.tasks):
            raise ValueError("작업 이름표가 중복됩니다.")
        if any(len(set(t.depends_on)) != len(t.depends_on) for t in self.tasks):
            raise ValueError("먼저 할 작업이 중복됩니다.")
        validate_graph({t.key: t.depends_on for t in self.tasks})
        return self


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: uuid.UUID
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(max_length=2000)
    estimated_minutes: int = Field(strict=True, ge=5, le=1440)
    priority: int = Field(strict=True, ge=1, le=5)
    latest_end: AwareDatetime
    selected: bool = Field(strict=True)
    depends_on: list[uuid.UUID] = Field(max_length=19)

    @field_validator("latest_end")
    @classmethod
    def normalized(cls, value):
        try:
            return value.astimezone(UTC)
        except OverflowError:
            raise ValueError("완료할 날짜를 확인해 주세요.") from None


class ReviewPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(strict=True, ge=1)
    candidates: list[Candidate] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def graph(self):
        if len({t.id for t in self.candidates}) != len(self.candidates):
            raise ValueError("같은 후보를 중복 입력할 수 없습니다.")
        if any(len(set(t.depends_on)) != len(t.depends_on) for t in self.candidates):
            raise ValueError("먼저 할 작업이 중복됩니다.")
        validate_graph({t.id: t.depends_on for t in self.candidates})
        return self


class PlanDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(strict=True, ge=1)


class DependencyEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    predecessor_ids: list[uuid.UUID] = Field(max_length=20)

    @model_validator(mode="after")
    def unique(self):
        if len(set(self.predecessor_ids)) != len(self.predecessor_ids):
            raise ValueError("같은 작업은 한 번만 선택해 주세요.")
        return self
