"""Reviewable AI proposals and account-owned prerequisite edges."""
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TaskProposal(Base):
    __tablename__ = "task_proposals"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id", name="uq_task_proposal_request"),
        CheckConstraint("status IN ('ready','approved','rejected')", name="ck_task_proposal_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    deadline_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("deadlines.id", ondelete="CASCADE"), index=True)
    request_id: Mapped[uuid.UUID] = mapped_column()
    input_hash: Mapped[str] = mapped_column(String(64))
    deadline_hash: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="ready")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    candidates: Mapped[list] = mapped_column(JSON)
    warnings: Mapped[list] = mapped_column(JSON)
    approved_task_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    __table_args__ = (CheckConstraint("task_id <> predecessor_id", name="ck_task_dependency_self"),)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    predecessor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
