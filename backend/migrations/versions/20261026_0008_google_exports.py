"""Add only durable Google send intents. Retain them on normal code rollback."""

import sqlalchemy as sa
from alembic import op

revision = "20261026_0008"
down_revision = "20261020_0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "google_calendar_exports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("connection_binding", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("google_event_id", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("error_code", sa.String(32), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "kind", "item_id", name="uq_google_export_item"),
        sa.CheckConstraint(
            "kind IN ('deadline', 'task', 'event')", name="ck_google_export_kind"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'conflict')", name="ck_google_export_status"
        ),
    )
    op.create_index(
        "ix_google_calendar_exports_user_id", "google_calendar_exports", ["user_id"]
    )
    op.create_index(
        "ix_google_calendar_exports_task_id", "google_calendar_exports", ["task_id"]
    )


def downgrade():
    # Explicit destructive operator action only; routine rollback keeps the table.
    op.drop_table("google_calendar_exports")
