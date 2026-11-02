"""Store per-item reminder choices without changing existing rows or queueing writes."""
import sqlalchemy as sa
from alembic import op

revision = "20261102_0011"
down_revision = "20261102_0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tasks", sa.Column("google_reminders", sa.JSON(none_as_null=True), nullable=True))
    op.add_column("deadlines", sa.Column("google_reminders", sa.JSON(none_as_null=True), nullable=True))


def downgrade():
    op.drop_column("deadlines", "google_reminders")
    op.drop_column("tasks", "google_reminders")
