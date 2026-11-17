"""Persist account working hours without changing existing schedules."""
import sqlalchemy as sa
from alembic import op

revision = "20261117_0017"
down_revision = "20261117_0016"
branch_labels = depends_on = None


def upgrade():
    op.create_table("availability_profiles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("weekly", sa.JSON(), nullable=False),
        sa.Column("exceptions", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_availability_revision"))


def downgrade():
    op.drop_table("availability_profiles")
