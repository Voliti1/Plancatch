"""Read-only projections of already registered dates, not new placements."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class CalendarRegistration(BaseModel):
    id: uuid.UUID
    kind: Literal["deadline", "fixed_task"]
    title: str
    start_at: datetime
    end_at: datetime | None = None
    is_confirmed: bool = True
    is_completed: bool = False


class CalendarRegistrationsPage(BaseModel):
    entries: list[CalendarRegistration]
    has_more: bool
