"""Keep excluded dates and linked single-occurrence edits without copying a series."""
import sqlalchemy as sa
from alembic import op

revision = "20261110_0014"
down_revision = "20261110_0013"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("excluded_starts", sa.JSON(none_as_null=True), nullable=True))
        batch.add_column(sa.Column("series_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("original_start", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key("fk_tasks_series_id", "tasks", ["series_id"], ["id"], ondelete="CASCADE")
        batch.create_index("ix_tasks_series_id", ["series_id"])
        batch.create_unique_constraint("uq_tasks_series_occurrence", ["series_id", "original_start"])


def downgrade():
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint("uq_tasks_series_occurrence", type_="unique")
        batch.drop_index("ix_tasks_series_id")
        batch.drop_constraint("fk_tasks_series_id", type_="foreignkey")
        batch.drop_column("original_start")
        batch.drop_column("series_id")
        batch.drop_column("excluded_starts")
