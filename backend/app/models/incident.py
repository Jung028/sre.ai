import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    source: Mapped[str] = mapped_column(String(50))  # pagerduty | datadog | grafana
    external_id: Mapped[str] = mapped_column(String(255), index=True)
    title: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20))  # critical | high | medium | low
    status: Mapped[str] = mapped_column(
        String(30), default="investigating"
    )  # investigating | resolved | needs_pr
    service_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    raw_payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    slack_thread_ts: Mapped[str | None] = mapped_column(String(50), nullable=True)
    slack_channel_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    alerts: Mapped[list["Alert"]] = relationship(
        "Alert", back_populates="incident", cascade="all, delete-orphan"
    )
    rca: Mapped["RCA | None"] = relationship(  # noqa: F821
        "RCA", back_populates="incident", uselist=False
    )


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    incident_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("incidents.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    labels: Mapped[dict] = mapped_column(JSONB, default=dict)
    fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    incident: Mapped["Incident"] = relationship("Incident", back_populates="alerts")
