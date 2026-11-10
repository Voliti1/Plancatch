"""Keep one recurrence rule per task, without duplicating user schedules."""
import sqlalchemy as sa
from alembic import op

revision = "20261110_0013"
down_revision = "20261103_0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tasks", sa.Column("recurrence", sa.JSON(none_as_null=True), nullable=True))


def downgrade():
    op.drop_column("tasks", "recurrence")
