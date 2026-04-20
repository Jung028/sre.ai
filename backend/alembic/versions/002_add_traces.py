"""add traces and spans tables

Revision ID: 002
Revises: 001
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "traces",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("trace_id", sa.String(128), nullable=False, unique=True, index=True),
        sa.Column("incident_id", UUID(as_uuid=False), nullable=True, index=True),
        sa.Column("service", sa.String(255), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="ok"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "spans",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("trace_id", UUID(as_uuid=False), sa.ForeignKey("traces.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("span_id", sa.String(128), nullable=False, index=True),
        sa.Column("parent_span_id", sa.String(128), nullable=True),
        sa.Column("service", sa.String(255), nullable=False),
        sa.Column("operation", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="ok"),
        sa.Column("start_offset_ms", sa.Float(), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("tags", JSONB(), nullable=False, server_default="{}"),
        sa.Column("logs", JSONB(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_table("spans")
    op.drop_table("traces")
