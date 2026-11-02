"""User choices for per-event Google reminders; never device permission settings."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Reminder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["popup", "email"]
    minutes: int = Field(strict=True, ge=0, le=40320)


class GoogleReminders(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["none", "default", "custom"]
    overrides: list[Reminder] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_choices(self):
        if self.mode == "custom" and not self.overrides:
            raise ValueError("직접 설정에는 알림을 하나 이상 추가해 주세요.")
        if self.mode != "custom" and self.overrides:
            raise ValueError("알림 시간은 직접 설정에서만 지정할 수 있습니다.")
        if len({(item.method, item.minutes) for item in self.overrides}) != len(self.overrides):
            raise ValueError("같은 알림 방식과 시간을 중복할 수 없습니다.")
        self.overrides.sort(key=lambda item: (item.method, item.minutes))
        return self


def default_reminders():
    return GoogleReminders(mode="none")
