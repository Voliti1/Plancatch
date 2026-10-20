"""Add only OAuth request and encrypted connection tables; preserve existing rows."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0007"
down_revision = "20260930_0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "google_calendar_connections",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_table(
        "google_oauth_requests",
        sa.Column("state_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("verifier_ciphertext", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index(
        "ix_google_oauth_requests_expires_at", "google_oauth_requests", ["expires_at"]
    )


def downgrade():
    # Explicit destructive rollback only. Routine code rollback must retain tables.
    op.drop_table("google_oauth_requests")
    op.drop_table("google_calendar_connections")
