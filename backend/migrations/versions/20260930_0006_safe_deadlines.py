"""Add optional user-selected safety buffers without changing existing due dates."""

import sqlalchemy as sa
from alembic import op

revision = "20260930_0006"
down_revision = "20260930_0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("deadlines", sa.Column("safety_buffer_minutes", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_deadlines_safety_buffer_minutes", "deadlines",
        "safety_buffer_minutes IS NULL OR safety_buffer_minutes > 0",
    )


def downgrade():
    # Explicit downgrade discards buffer settings; never use it for a routine code rollback.
    op.drop_constraint("ck_deadlines_safety_buffer_minutes", "deadlines", type_="check")
    op.drop_column("deadlines", "safety_buffer_minutes")
