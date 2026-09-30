"""Persist AI review proposals without modifying existing user data."""
import sqlalchemy as sa
from alembic import op

revision = "20260930_0005"
down_revision = "20260930_0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "analyses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.Uuid(), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("candidates", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("approved_deadline_ids", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('processing', 'ready', 'approved', 'rejected', 'failed')",
                           name="ck_analyses_status"),
    )
    op.create_index("ix_analyses_user_id", "analyses", ["user_id"])
    op.create_index("ix_analyses_source_id", "analyses", ["source_id"])
    op.create_index("uq_analyses_active_source", "analyses", ["source_id"], unique=True,
                    postgresql_where=sa.text("status = 'processing'"),
                    sqlite_where=sa.text("status = 'processing'"))


def downgrade():
    op.drop_table("analyses")
