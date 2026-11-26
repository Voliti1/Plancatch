"""Canonical, bounded Seoul-local weekly windows and whole-date replacements."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_minutes: int = Field(strict=True, ge=0, le=1439)
    end_minutes: int = Field(strict=True, ge=1, le=1440)

    @model_validator(mode="after")
    def ordered(self):
        if self.start_minutes >= self.end_minutes:
            raise ValueError("종료 시간은 시작 시간보다 늦어야 합니다. 자정을 넘으면 날짜별로 나누어 주세요.")
        return self


class Windows(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intervals: list[Window] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def disjoint(self):
        self.intervals.sort(key=lambda w: w.start_minutes)
        if any(a.end_minutes > b.start_minutes for a, b in zip(self.intervals, self.intervals[1:])):
            raise ValueError("가능한 시간대가 서로 겹칩니다. 시간을 확인해 주세요.")
        return self


class WeeklyDay(Windows):
    weekday: int = Field(strict=True, ge=0, le=6)
    rest_day: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def rest_has_no_windows(self):
        if self.rest_day and self.intervals:
            raise ValueError("휴식일에는 작업 시간을 지정할 수 없습니다.")
        return self


class DateOverride(Windows):
    date: date

    @field_validator("date", mode="before")
    @classmethod
    def exact_date(cls, value):
        if isinstance(value, str):
            try:
                if date.fromisoformat(value).isoformat() == value:
                    return value
            except ValueError:
                pass
        elif type(value) is date:
            return value
        raise ValueError("날짜는 연도-월-일 형식으로 입력해 주세요.")


def default_weekly():
    return [WeeklyDay(weekday=d, intervals=[Window(start_minutes=540, end_minutes=1080)] if d < 5 else []) for d in range(7)]


class AvailabilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(strict=True, ge=0)
    timezone: Literal["Asia/Seoul"] = "Asia/Seoul"
    weekly: list[WeeklyDay] = Field(max_length=7)
    exceptions: list[DateOverride] = Field(default_factory=list, max_length=366)

    @model_validator(mode="after")
    def unique(self):
        if len({d.weekday for d in self.weekly}) != len(self.weekly):
            raise ValueError("같은 요일은 한 번만 설정해 주세요.")
        if len({d.date for d in self.exceptions}) != len(self.exceptions):
            raise ValueError("같은 날짜는 한 번만 설정해 주세요.")
        days = {d.weekday: d for d in self.weekly}
        self.weekly = [days.get(d, WeeklyDay(weekday=d)) for d in range(7)]
        self.exceptions.sort(key=lambda d: d.date)
        return self
