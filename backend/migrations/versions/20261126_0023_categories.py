"""Add optional schedule categories without altering existing data."""
import sqlalchemy as sa
from alembic import op

revision = "20261126_0023"
down_revision = "20261126_0022"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("deadlines", "tasks"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("category", sa.String(20), nullable=True))
            batch.create_check_constraint(f"ck_{table}_category", "category IS NULL OR category IN ('career', 'study', 'work', 'personal', 'other')")
            batch.create_index(f"ix_{table}_category", ["category"])


def downgrade():
    for table in ("tasks", "deadlines"):
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f"ix_{table}_category")
            batch.drop_constraint(f"ck_{table}_category", type_="check")
            batch.drop_column("category")
