"""Add recoverable Google change intents; routine rollback retains these fields."""
import sqlalchemy as sa
from alembic import op

revision = "20261102_0009"
down_revision = "20261026_0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("google_calendar_exports", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("google_calendar_exports", sa.Column("mutation", sa.JSON(), nullable=True))
    op.add_column("google_calendar_exports", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    # Explicit destructive operator action only. Normal code rollback keeps intents/tombstones.
    op.drop_column("google_calendar_exports", "deleted_at")
    op.drop_column("google_calendar_exports", "mutation")
    op.drop_column("google_calendar_exports", "revision")
