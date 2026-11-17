"""Track processing attempts and expiry without changing saved source content."""
import sqlalchemy as sa
from alembic import op

revision = "20261117_0016"
down_revision = "20261110_0015"
branch_labels = depends_on = None


def upgrade():
    for table, status in (("sources", "processing_status"), ("analyses", "status")):
        op.add_column(table, sa.Column("processing_run_id", sa.Uuid(), nullable=True))
        op.add_column(table, sa.Column("processing_lease_until", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"ix_{table}_processing_lease", table, ["processing_lease_until"],
                        postgresql_where=sa.text(f"{status} = 'processing'"),
                        sqlite_where=sa.text(f"{status} = 'processing'"))


def downgrade():
    for table in ("analyses", "sources"):
        op.drop_index(f"ix_{table}_processing_lease", table)
        op.drop_column(table, "processing_lease_until")
        op.drop_column(table, "processing_run_id")
