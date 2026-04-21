"""add code_context to rcas

Revision ID: 003
Revises: 002
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("rcas", sa.Column("code_context", JSONB(), nullable=True))

def downgrade() -> None:
    op.drop_column("rcas", "code_context")
