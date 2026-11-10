"""A bounded, structured subset of calendar recurrence rules."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Recurrence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: Literal["daily", "weekly", "monthly"]
    interval: int = Field(default=1, ge=1, le=99, strict=True)
    count: int | None = Field(default=None, ge=1, le=1000, strict=True)
    until: date | None = None

    @model_validator(mode="after")
    def one_end(self):
        if self.count is not None and self.until is not None:
            raise ValueError("반복 종료일과 횟수 중 하나만 설정해 주세요.")
        return self
