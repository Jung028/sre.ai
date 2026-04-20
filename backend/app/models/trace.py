"""Distributed trace and span models."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    trace_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)  # external trace ID from APM
    incident_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    service: Mapped[str] = mapped_column(String(255))  # root service
    duration_ms: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok | error | slow
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    spans: Mapped[list["Span"]] = relationship("Span", back_populates="trace", cascade="all, delete-orphan")


class Span(Base):
    __tablename__ = "spans"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    trace_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("traces.id", ondelete="CASCADE"), index=True)
    span_id: Mapped[str] = mapped_column(String(128), index=True)  # external span ID
    parent_span_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    service: Mapped[str] = mapped_column(String(255))
    operation: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok | error | slow
    start_offset_ms: Mapped[float] = mapped_column(Float)  # ms from trace start
    duration_ms: Mapped[float] = mapped_column(Float)
    tags: Mapped[dict] = mapped_column(JSONB, default=dict)
    logs: Mapped[list] = mapped_column(JSONB, default=list)  # [{ts, level, message}, ...]

    trace: Mapped["Trace"] = relationship("Trace", back_populates="spans")
