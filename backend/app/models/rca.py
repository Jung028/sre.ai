import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class RCA(Base):
    __tablename__ = "rcas"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    incident_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    root_cause: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)  # full markdown
    confidence: Mapped[str] = mapped_column(String(10))  # high | medium | low
    hypothesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeline: Mapped[list] = mapped_column(JSONB, default=list)
    recommended_actions: Mapped[list] = mapped_column(JSONB, default=list)
    needs_pr: Mapped[bool] = mapped_column(Boolean, default=False)
    pr_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_pr_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_used: Mapped[str] = mapped_column(String(100))
    raw_messages: Mapped[list] = mapped_column(JSONB, default=list)  # full Claude conversation
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    incident: Mapped["Incident"] = relationship("Incident", back_populates="rca")  # noqa: F821
    evidence: Mapped[list["Evidence"]] = relationship(
        "Evidence", back_populates="rca", cascade="all, delete-orphan"
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    rca_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("rcas.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))  # log | metric | trace | code | deployment
    source: Mapped[str] = mapped_column(String(50))  # datadog | grafana | github
    query: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)  # truncated raw content
    significance: Mapped[str] = mapped_column(Text)  # why this matters

    rca: Mapped["RCA"] = relationship("RCA", back_populates="evidence")
