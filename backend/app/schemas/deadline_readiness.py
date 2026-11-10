"""A read-only explanation of local deadline preparation, not a probability."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class DeadlineReadiness(BaseModel):
    deadline_id: uuid.UUID
    assessed_at: datetime
    target_at: datetime
    uses_safety_deadline: bool
    status: Literal[
        "overdue", "shortage", "attention", "unknown", "planned", "completed"
    ]
    reasons: list[str]
    task_count: int
    completed_count: int
    unknown_task_count: int
    known_required_minutes: int
    required_minutes: int | None
    planned_minutes: int
    unplanned_minutes: int | None
    remaining_minutes: int
    truncated: bool
