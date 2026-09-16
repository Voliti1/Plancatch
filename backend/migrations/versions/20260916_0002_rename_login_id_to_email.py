"""Rename login ID to email.

Revision ID: 20260916_0002
Revises: 20260916_0001
Create Date: 2026-09-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_0002"
down_revision: str | None = "20260916_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rename the login identifier column to email."""
    op.drop_index("ix_users_login_id", table_name="users")
    op.alter_column(
        "users",
        "login_id",
        new_column_name="email",
        existing_type=sa.String(length=100),
        type_=sa.String(length=320),
        existing_nullable=False,
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)


def downgrade() -> None:
    """Restore the original login identifier column."""
    op.drop_index("ix_users_email", table_name="users")
    op.alter_column(
        "users",
        "email",
        new_column_name="login_id",
        existing_type=sa.String(length=320),
        type_=sa.String(length=100),
        existing_nullable=False,
    )
    op.create_index("ix_users_login_id", "users", ["login_id"], unique=True)
