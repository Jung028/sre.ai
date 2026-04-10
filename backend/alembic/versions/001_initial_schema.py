"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "incidents",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=False, index=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="investigating"),
        sa.Column("service_name", sa.String(255), nullable=True),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_payload", JSONB(), nullable=False, server_default="{}"),
        sa.Column("slack_thread_ts", sa.String(50), nullable=True),
        sa.Column("slack_channel_id", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "alerts",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "incident_id",
            UUID(as_uuid=False),
            sa.ForeignKey("incidents.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("labels", JSONB(), nullable=False, server_default="{}"),
        sa.Column("fired_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "rcas",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "incident_id",
            UUID(as_uuid=False),
            sa.ForeignKey("incidents.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("root_cause", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("confidence", sa.String(10), nullable=False),
        sa.Column("hypothesis", sa.Text(), nullable=True),
        sa.Column("timeline", JSONB(), nullable=False, server_default="[]"),
        sa.Column("recommended_actions", JSONB(), nullable=False, server_default="[]"),
        sa.Column("needs_pr", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("pr_description", sa.Text(), nullable=True),
        sa.Column("github_pr_url", sa.String(500), nullable=True),
        sa.Column("model_used", sa.String(100), nullable=False),
        sa.Column("raw_messages", JSONB(), nullable=False, server_default="[]"),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "evidence",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "rca_id",
            UUID(as_uuid=False),
            sa.ForeignKey("rcas.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("significance", sa.Text(), nullable=False),
    )

    op.create_table(
        "runbooks",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("service_name", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="generated"),
        sa.Column("generated_from_rca_id", sa.String(36), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("runbooks")
    op.drop_table("evidence")
    op.drop_table("rcas")
    op.drop_table("alerts")
    op.drop_table("incidents")
