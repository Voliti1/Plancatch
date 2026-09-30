"""Add extraction and login-required states.

Revision ID: 20260930_0004
Revises: 20260916_0003
"""

from alembic import op

revision = "20260930_0004"
down_revision = "20260916_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_sources_processing_status", "sources", type_="check")
    op.create_check_constraint(
        "ck_sources_processing_status", "sources",
        "processing_status IN ('pending', 'processing', 'extracted', 'requires_login', 'completed', 'failed')",
    )


def downgrade():
    op.execute("UPDATE sources SET processing_status='pending' WHERE processing_status='extracted'")
    op.execute("UPDATE sources SET processing_status='failed' WHERE processing_status='requires_login'")
    op.drop_constraint("ck_sources_processing_status", "sources", type_="check")
    op.create_check_constraint(
        "ck_sources_processing_status", "sources",
        "processing_status IN ('pending', 'processing', 'completed', 'failed')",
    )
