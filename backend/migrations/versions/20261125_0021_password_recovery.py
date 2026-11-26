"""Add expiring, hashed temporary passwords."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_0021"
down_revision = "20261125_0020"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("recovery_password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("recovery_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("users", "recovery_expires_at")
    op.drop_column("users", "recovery_password_hash")
