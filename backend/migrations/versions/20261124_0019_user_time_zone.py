"""Persist the account's display time zone."""

import sqlalchemy as sa
from alembic import op

revision = "20261124_0019"
down_revision = "20261117_0018"
branch_labels = depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("time_zone", sa.String(64), server_default="Asia/Seoul", nullable=False),
    )


def downgrade():
    op.drop_column("users", "time_zone")
