from datetime import datetime
from typing import Any

from pydantic import BaseModel


class IncidentOut(BaseModel):
    id: str
    source: str
    external_id: str
    title: str
    severity: str
    status: str
    service_name: str | None
    triggered_at: datetime
    resolved_at: datetime | None
    slack_thread_ts: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RCAOut(BaseModel):
    id: str
    incident_id: str
    root_cause: str
    summary: str
    confidence: str
    timeline: list[dict[str, Any]]
    recommended_actions: list[dict[str, Any]]
    needs_pr: bool
    code_context: dict | None = None
    github_pr_url: str | None
    model_used: str
    generated_at: datetime

    model_config = {"from_attributes": True}


class IncidentWithRCAOut(IncidentOut):
    rca: RCAOut | None = None
