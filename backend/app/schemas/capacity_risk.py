"""A bounded feasibility check, never a probability or calendar reservation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class CapacityRisk(BaseModel):
    level: Literal[
        "completed",
        "overdue",
        "insufficient",
        "tight",
        "feasible",
        "attention",
        "unknown",
    ]
    checked_until: datetime
    includes_google: bool
    google_state: str
    working_minutes: int | None = None
    free_minutes: int | None = None
    reserved_minutes: int | None = None
    known_required_minutes: int = 0
    required_minutes: int | None = None
    to_schedule_minutes: int | None = None
    unplaced_minutes: int | None = None
    prerequisite_count: int = 0
    incomplete: bool = False
    reasons: list[str]
