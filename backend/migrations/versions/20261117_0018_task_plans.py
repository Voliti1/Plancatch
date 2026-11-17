"""Add proposal receipts and prerequisite edges; keep existing work untouched."""
import sqlalchemy as sa
from alembic import op

revision = "20261117_0018"
down_revision = "20261117_0017"
branch_labels = depends_on = None


def upgrade():
    op.create_table("task_proposals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deadline_id", sa.Uuid(), sa.ForeignKey("deadlines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("deadline_hash", sa.String(64), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("candidates", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("approved_task_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "request_id", name="uq_task_proposal_request"),
        sa.CheckConstraint("status IN ('ready','approved','rejected')", name="ck_task_proposal_status"))
    for column in ("user_id", "deadline_id"):
        op.create_index(f"ix_task_proposals_{column}", "task_proposals", [column])
    op.create_table("task_dependencies",
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("predecessor_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.CheckConstraint("task_id <> predecessor_id", name="ck_task_dependency_self"))
    for column in ("user_id", "predecessor_id"):
        op.create_index(f"ix_task_dependencies_{column}", "task_dependencies", [column])


def downgrade():
    op.drop_table("task_dependencies")
    op.drop_table("task_proposals")
