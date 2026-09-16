"""Scheduled time block for completing a task."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScheduledEvent(Base):
    """A recommended or approved task placement on a calendar."""

    __tablename__ = "scheduled_events"
    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_scheduled_events_time_range"),
        CheckConstraint(
            "status IN ('recommended', 'approved', 'synced', 'cancelled')",
            name="ck_scheduled_events_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"),
        index=True,
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        String(20),
        default="recommended",
        server_default="recommended",
    )
    is_user_approved: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="false",
    )
    google_calendar_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    google_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
