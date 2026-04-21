from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class NormalizedAlert:
    source: str
    external_id: str
    title: str
    severity: str  # critical | high | medium | low
    service_name: str | None
    description: str
    labels: dict[str, str]
    fired_at: datetime
    runbook_url: str | None
    raw: dict


def _parse_severity(value: str) -> str:
    v = value.lower()
    if v in ("critical", "p1", "sev1", "fatal"):
        return "critical"
    if v in ("high", "p2", "sev2", "error"):
        return "high"
    if v in ("medium", "p3", "sev3", "warning", "warn"):
        return "medium"
    return "low"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_pagerduty(event: dict) -> NormalizedAlert:
    """Normalize a PagerDuty v3 webhook event dict."""
    data = event.get("data", event)
    service = data.get("service", {})
    body = data.get("body", {})

    return NormalizedAlert(
        source="pagerduty",
        external_id=data.get("id", ""),
        title=data.get("title", data.get("summary", "PagerDuty Incident")),
        severity=_parse_severity(data.get("severity", data.get("urgency", "high"))),
        service_name=service.get("summary") or service.get("name") if isinstance(service, dict) else None,
        description=body.get("details", "") if isinstance(body, dict) else str(body),
        labels={
            "priority": data.get("priority", {}).get("summary", "") if isinstance(data.get("priority"), dict) else "",
            "type": event.get("event", event.get("event_type", "")),
        },
        fired_at=_parse_dt(data.get("created_at")),
        runbook_url=None,
        raw=event,
    )


def normalize_datadog(payload: dict) -> NormalizedAlert:
    """Normalize a Datadog webhook payload."""
    return NormalizedAlert(
        source="datadog",
        external_id=str(payload.get("id", payload.get("alert_id", ""))),
        title=payload.get("title", payload.get("alert_title", "Datadog Alert")),
        severity=_parse_severity(payload.get("priority", payload.get("severity", "high"))),
        service_name=payload.get("tags", {}).get("service") if isinstance(payload.get("tags"), dict)
                     else _extract_tag(payload.get("tags", []), "service"),
        description=payload.get("body", payload.get("text", "")),
        labels={
            "monitor_id": str(payload.get("alert_id", "")),
            "type": payload.get("alert_type", ""),
        },
        fired_at=_parse_dt(payload.get("date")),
        runbook_url=payload.get("runbook"),
        raw=payload,
    )


def normalize_grafana(payload: dict) -> NormalizedAlert:
    """Normalize a Grafana webhook payload (Grafana 9+ unified alerting)."""
    alerts = payload.get("alerts", [payload])
    alert = alerts[0] if alerts else payload
    labels = alert.get("labels", {})

    return NormalizedAlert(
        source="grafana",
        external_id=alert.get("fingerprint", ""),
        title=payload.get("title", alert.get("labels", {}).get("alertname", "Grafana Alert")),
        severity=_parse_severity(labels.get("severity", "high")),
        service_name=labels.get("service") or labels.get("job"),
        description=alert.get("annotations", {}).get("summary", alert.get("annotations", {}).get("description", "")),
        labels=labels,
        fired_at=_parse_dt(alert.get("startsAt")),
        runbook_url=alert.get("annotations", {}).get("runbook_url"),
        raw=payload,
    )


def _parse_dt(value: str | int | None) -> datetime:
    if value is None:
        return _now()
    if isinstance(value, int):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return _now()


def _extract_tag(tags: list | str, key: str) -> str | None:
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    for tag in tags:
        if isinstance(tag, str) and tag.startswith(f"{key}:"):
            return tag.split(":", 1)[1]
    return None
