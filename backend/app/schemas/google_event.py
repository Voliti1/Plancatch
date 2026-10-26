"""Minimal private calendar view; no attendees, descriptions, or credentials."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class GoogleEventView(BaseModel):
    id: str
    title: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    start_date: date | None = None
    end_date: date | None = None
    local_kind: Literal["deadline", "task", "event"] | None = None
    local_item_id: uuid.UUID | None = None


class GoogleEventsPage(BaseModel):
    events: list[GoogleEventView]
    has_more: bool = False
    skipped_count: int = 0
