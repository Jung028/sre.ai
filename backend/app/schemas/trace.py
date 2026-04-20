from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SpanIn(BaseModel):
    span_id: str
    parent_span_id: str | None = None
    service: str
    operation: str
    status: str = "ok"
    start_offset_ms: float
    duration_ms: float
    tags: dict[str, Any] = {}
    logs: list[dict[str, Any]] = []


class TraceIn(BaseModel):
    trace_id: str
    incident_id: str | None = None
    service: str
    duration_ms: float
    status: str = "ok"
    started_at: datetime
    spans: list[SpanIn] = []


class SpanOut(BaseModel):
    id: str
    trace_id: str
    span_id: str
    parent_span_id: str | None
    service: str
    operation: str
    status: str
    start_offset_ms: float
    duration_ms: float
    tags: dict[str, Any]
    logs: list[dict[str, Any]]

    model_config = {"from_attributes": True}


class TraceOut(BaseModel):
    id: str
    trace_id: str
    incident_id: str | None
    service: str
    duration_ms: float
    status: str
    started_at: datetime
    created_at: datetime
    spans: list[SpanOut]

    model_config = {"from_attributes": True}


class TraceSummary(BaseModel):
    id: str
    trace_id: str
    incident_id: str | None
    service: str
    duration_ms: float
    status: str
    started_at: datetime
    span_count: int

    model_config = {"from_attributes": True}
