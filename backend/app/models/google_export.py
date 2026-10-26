"""Durable immutable send intents; survive deletion of the local source item."""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GoogleExport(Base):
    __tablename__ = "google_calendar_exports"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "item_id", name="uq_google_export_item"),
        CheckConstraint(
            "kind IN ('deadline', 'task', 'event')", name="ck_google_export_kind"
        ),
        CheckConstraint(
            "status IN ('pending', 'sent', 'conflict')", name="ck_google_export_status"
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    item_id: Mapped[uuid.UUID] = mapped_column()
    task_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    connection_binding: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    payload_hash: Mapped[str] = mapped_column(String(64))
    google_event_id: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending"
    )
    error_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
