"""Persist automatic synchronization without sending existing records on upgrade."""
import sqlalchemy as sa
from alembic import op

revision = "20261102_0010"
down_revision = "20261102_0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("google_calendar_exports", sa.Column("desired_payload", sa.JSON(), nullable=True))
    op.add_column("google_calendar_exports", sa.Column("sync_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("google_calendar_exports", sa.Column("sync_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("google_calendar_exports", sa.Column("retry_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_google_calendar_exports_sync_pending", "google_calendar_exports", ["sync_pending"])


def downgrade():
    # Never use this for an application rollback: it would discard queued changes.
    op.drop_index("ix_google_calendar_exports_sync_pending", table_name="google_calendar_exports")
    for name in ("retry_at", "sync_attempts", "sync_pending", "desired_payload"):
        op.drop_column("google_calendar_exports", name)
