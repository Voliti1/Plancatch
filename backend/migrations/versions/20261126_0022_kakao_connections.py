"""Store Kakao login identity and encrypted calendar connection on each account."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_0022"
down_revision = "20261125_0021"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("kakao_subject", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("kakao_calendar_token", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("kakao_calendar_state", sa.String(64), nullable=True))
    op.create_index("ix_users_kakao_subject", "users", ["kakao_subject"], unique=True)


def downgrade():
    op.drop_index("ix_users_kakao_subject", table_name="users")
    op.drop_column("users", "kakao_calendar_state")
    op.drop_column("users", "kakao_calendar_token")
    op.drop_column("users", "kakao_subject")
