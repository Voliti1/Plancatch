"""Store file names, extracted metadata and redirects to reused reviews."""
import sqlalchemy as sa
from alembic import op

revision = "20261103_0012"
down_revision = "20261102_0011"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sources") as batch:
        batch.add_column(sa.Column("original_filename", sa.String(255), nullable=True))
        batch.add_column(sa.Column("file_metadata", sa.JSON(none_as_null=True), nullable=True))
        batch.create_index("ix_sources_owner_filename", ["user_id", "original_filename"])
    with op.batch_alter_table("analyses") as batch:
        batch.add_column(sa.Column("reused_analysis_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_analyses_reused_analysis", "analyses", ["reused_analysis_id"], ["id"],
                                 ondelete="CASCADE")
        batch.create_index("ix_analyses_reused_analysis_id", ["reused_analysis_id"])


def downgrade():
    with op.batch_alter_table("analyses") as batch:
        batch.drop_index("ix_analyses_reused_analysis_id")
        batch.drop_constraint("fk_analyses_reused_analysis", type_="foreignkey")
        batch.drop_column("reused_analysis_id")
    with op.batch_alter_table("sources") as batch:
        batch.drop_index("ix_sources_owner_filename")
        batch.drop_column("file_metadata")
        batch.drop_column("original_filename")
