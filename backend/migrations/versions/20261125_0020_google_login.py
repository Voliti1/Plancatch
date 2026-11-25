"""Link PlanCatch users to a verified Google subject."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_0020"
down_revision = "20261124_0019"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("password_enabled", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("users", sa.Column("google_subject", sa.String(255), nullable=True))
    op.create_index("ix_users_google_subject", "users", ["google_subject"], unique=True)


def downgrade():
    op.drop_index("ix_users_google_subject", table_name="users")
    op.drop_column("users", "google_subject")
    op.drop_column("users", "password_enabled")
