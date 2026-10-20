"""Minimal private calendar view; no attendees, descriptions, or credentials."""

from datetime import date, datetime

from pydantic import BaseModel


class GoogleEventView(BaseModel):
    id: str
    title: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    start_date: date | None = None
    end_date: date | None = None


class GoogleEventsPage(BaseModel):
    events: list[GoogleEventView]
    has_more: bool = False
    skipped_count: int = 0
