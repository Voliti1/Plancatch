import uuid
from datetime import UTC, timedelta

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class PreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    start_at: AwareDatetime
    end_at: AwareDatetime
    day_start_minutes: int = Field(default=540, strict=True, ge=0, le=1439)
    day_end_minutes: int = Field(default=1080, strict=True, ge=1, le=1440)
    weekdays: list[int] = Field(
        default_factory=lambda: [0, 1, 2, 3, 4], min_length=1, max_length=7
    )
    chunk_minutes: int = Field(default=60, strict=True, ge=15, le=240)
    include_google: bool = Field(default=True, strict=True)

    @field_validator("weekdays", mode="before")
    @classmethod
    def strict_days(cls, value):
        if not isinstance(value, list) or any(type(day) is not int for day in value):
            raise ValueError("작업할 요일을 확인해 주세요.")
        return value

    @field_validator("start_at", "end_at")
    @classmethod
    def normalized(cls, value):
        try:
            return value.astimezone(UTC)
        except OverflowError:
            raise ValueError("확인할 수 있는 날짜 범위를 벗어났습니다.") from None

    @model_validator(mode="after")
    def bounds(self):
        if not timedelta(0) < self.end_at - self.start_at <= timedelta(days=31):
            raise ValueError("배치 기간은 31일 이내로 선택해 주세요.")
        if self.day_start_minutes >= self.day_end_minutes:
            raise ValueError("작업 종료 시간은 시작 시간보다 늦어야 합니다.")
        if len(set(self.task_ids)) != len(self.task_ids):
            raise ValueError("같은 할 일을 중복 선택할 수 없습니다.")
        if any(
            type(day) is not int or not 0 <= day <= 6 for day in self.weekdays
        ) or len(set(self.weekdays)) != len(self.weekdays):
            raise ValueError("작업할 요일을 확인해 주세요.")
        return self


class EditedBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    start_at: AwareDatetime
    end_at: AwareDatetime

    @field_validator("start_at", "end_at")
    @classmethod
    def normalized(cls, value):
        try:
            return value.astimezone(UTC)
        except OverflowError:
            raise ValueError("확인할 수 있는 날짜 범위를 벗어났습니다.") from None


class ApprovalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blocks: list[EditedBlock] = Field(min_length=1, max_length=200)
