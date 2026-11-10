"""Durable preview/approval receipts; existing schedules and task columns stay intact."""

import sqlalchemy as sa
from alembic import op

revision = "20261110_0015"
down_revision = "20261110_0014"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "schedule_plans",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request", sa.JSON(), nullable=False),
        sa.Column("snapshot_hash", sa.String(64), nullable=False),
        sa.Column("blocks", sa.JSON(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_event_ids", sa.JSON(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_schedule_plans_owner_expiry", "schedule_plans", ["user_id", "expires_at"]
    )


def downgrade():
    op.drop_index("ix_schedule_plans_owner_expiry", "schedule_plans")
    op.drop_table("schedule_plans")
