"""An advisory preview; never creates, changes, or reserves calendar time."""
import uuid
from datetime import UTC

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    field_validator,
    model_validator,
)

from app.schemas.recurrence import Recurrence
from app.services.recurrence import validate


class ConflictCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_at: AwareDatetime
    end_at: AwareDatetime
    recurrence: Recurrence | None = None
    exclude_task_id: uuid.UUID | None = None
    exclude_event_id: uuid.UUID | None = None
    placement_task_id: uuid.UUID | None = None

    @field_validator("start_at", "end_at")
    @classmethod
    def normalize(cls, value):
        try:
            return value.astimezone(UTC)
        except OverflowError:
            raise ValueError("확인할 수 있는 날짜 범위를 벗어났습니다.") from None

    @model_validator(mode="after")
    def window(self):
        if self.start_at >= self.end_at:
            raise ValueError("종료 일시는 시작 일시보다 늦게 설정해 주세요.")
        validate(self.recurrence, "fixed", self.start_at, self.end_at)
        return self
