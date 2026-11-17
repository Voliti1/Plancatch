"""Account-owned working hours; no change to existing calendar events."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AvailabilityProfile(Base):
    __tablename__ = "availability_profiles"
    __table_args__ = (CheckConstraint("revision >= 1", name="ck_availability_revision"),)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer)
    weekly: Mapped[list] = mapped_column(JSON)
    exceptions: Mapped[list] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
