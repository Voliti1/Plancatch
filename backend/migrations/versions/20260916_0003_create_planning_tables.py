"""Create source, deadline, task, and scheduled event tables.

Revision ID: 20260916_0003
Revises: 20260916_0002
Create Date: 2026-09-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_0003"
down_revision: str | None = "20260916_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the core PlanCatch planning tables."""
    op.create_table(
        "sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("original_url", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.String(length=1024), nullable=True),
        sa.Column("original_text", sa.Text(), nullable=True),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column(
            "processing_status",
            sa.String(length=20),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "processing_status IN ('pending', 'processing', 'completed', 'failed')",
            name="ck_sources_processing_status",
        ),
        sa.CheckConstraint(
            "source_type IN ('url', 'pdf', 'image', 'text')",
            name="ck_sources_source_type",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sources_user_id", "sources", ["user_id"])

    op.create_table(
        "deadlines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_type", sa.String(length=50), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("evidence_text", sa.Text(), nullable=True),
        sa.Column(
            "is_confirmed",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_deadlines_confidence",
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["sources.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deadlines_due_at", "deadlines", ["due_at"])
    op.create_index("ix_deadlines_source_id", "deadlines", ["source_id"])
    op.create_index("ix_deadlines_user_id", "deadlines", ["user_id"])

    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("deadline_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("estimated_minutes", sa.Integer(), nullable=True),
        sa.Column("priority", sa.SmallInteger(), server_default="3", nullable=False),
        sa.Column(
            "schedule_type",
            sa.String(length=20),
            server_default="flexible",
            nullable=False,
        ),
        sa.Column("earliest_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latest_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_completed",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "estimated_minutes IS NULL OR estimated_minutes > 0",
            name="ck_tasks_estimated_minutes",
        ),
        sa.CheckConstraint(
            "priority >= 1 AND priority <= 5",
            name="ck_tasks_priority",
        ),
        sa.CheckConstraint(
            "schedule_type IN ('fixed', 'flexible')",
            name="ck_tasks_schedule_type",
        ),
        sa.ForeignKeyConstraint(
            ["deadline_id"],
            ["deadlines.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_deadline_id", "tasks", ["deadline_id"])
    op.create_index("ix_tasks_user_id", "tasks", ["user_id"])

    op.create_table(
        "scheduled_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="recommended",
            nullable=False,
        ),
        sa.Column(
            "is_user_approved",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
        sa.Column("google_calendar_id", sa.String(length=255), nullable=True),
        sa.Column("google_event_id", sa.String(length=255), nullable=True),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "end_at > start_at",
            name="ck_scheduled_events_time_range",
        ),
        sa.CheckConstraint(
            "status IN ('recommended', 'approved', 'synced', 'cancelled')",
            name="ck_scheduled_events_status",
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_scheduled_events_start_at",
        "scheduled_events",
        ["start_at"],
    )
    op.create_index("ix_scheduled_events_task_id", "scheduled_events", ["task_id"])
    op.create_index("ix_scheduled_events_user_id", "scheduled_events", ["user_id"])


def downgrade() -> None:
    """Drop the core PlanCatch planning tables."""
    op.drop_index("ix_scheduled_events_user_id", table_name="scheduled_events")
    op.drop_index("ix_scheduled_events_task_id", table_name="scheduled_events")
    op.drop_index("ix_scheduled_events_start_at", table_name="scheduled_events")
    op.drop_table("scheduled_events")
    op.drop_index("ix_tasks_user_id", table_name="tasks")
    op.drop_index("ix_tasks_deadline_id", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("ix_deadlines_user_id", table_name="deadlines")
    op.drop_index("ix_deadlines_source_id", table_name="deadlines")
    op.drop_index("ix_deadlines_due_at", table_name="deadlines")
    op.drop_table("deadlines")
    op.drop_index("ix_sources_user_id", table_name="sources")
    op.drop_table("sources")
