import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import SignatureVerificationError
from app.core.signatures import (
    verify_datadog_signature,
    verify_grafana_signature,
    verify_pagerduty_signature,
)
from app.database import get_db
from app.models.incident import Alert, Incident
from app.services.alert_normalizer import (
    NormalizedAlert,
    normalize_datadog,
    normalize_grafana,
    normalize_pagerduty,
)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def _create_incident(db: AsyncSession, alert: NormalizedAlert) -> Incident:
    incident = Incident(
        id=str(uuid.uuid4()),
        source=alert.source,
        external_id=alert.external_id or str(uuid.uuid4()),
        title=alert.title,
        severity=alert.severity,
        status="investigating",
        service_name=alert.service_name,
        triggered_at=alert.fired_at,
        raw_payload={"normalized": _alert_to_dict(alert), "original": alert.raw},
    )
    db.add(incident)

    db_alert = Alert(
        id=str(uuid.uuid4()),
        incident_id=incident.id,
        source=alert.source,
        title=alert.title,
        description=alert.description,
        labels=alert.labels,
        fired_at=alert.fired_at,
    )
    db.add(db_alert)
    await db.flush()
    return incident


def _alert_to_dict(alert: NormalizedAlert) -> dict:
    return {
        "source": alert.source,
        "external_id": alert.external_id,
        "title": alert.title,
        "severity": alert.severity,
        "service_name": alert.service_name,
        "description": alert.description,
        "labels": alert.labels,
        "fired_at": alert.fired_at.isoformat(),
        "runbook_url": alert.runbook_url,
    }


async def _enqueue_investigation(incident_id: str):
    """
    Run the investigation directly as a FastAPI background task.
    No Celery worker required for local dev — the coroutine runs in the
    same event loop as FastAPI, publishing SSE events to Redis pub/sub.
    """
    from app.workers.tasks import _run_investigation
    await _run_investigation(incident_id)


@router.post("/pagerduty")
async def pagerduty_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    x_pagerduty_signature: str = Header(default="", alias="X-PagerDuty-Signature"),
):
    raw_body = (await request.body()).decode()
    try:
        verify_pagerduty_signature(
            settings.pagerduty_webhook_secret, x_pagerduty_signature, raw_body
        )
    except SignatureVerificationError as e:
        raise HTTPException(status_code=401, detail=str(e))

    payload = json.loads(raw_body)
    incident_ids = []

    for msg in payload.get("messages", [payload]):
        event_type = msg.get("event", "")  # string e.g. "incident.triggered"
        if event_type not in ("incident.triggered", "incident.acknowledged", ""):
            continue
        alert = normalize_pagerduty(msg)
        incident = await _create_incident(db, alert)
        incident_ids.append(incident.id)

    await db.commit()
    for iid in incident_ids:
        background_tasks.add_task(_enqueue_investigation, iid)

    return {"ok": True, "incidents": incident_ids}


@router.post("/datadog")
async def datadog_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    x_datadog_signature: str = Header(default="", alias="X-Datadog-Signature"),
):
    raw_body = (await request.body()).decode()
    try:
        verify_datadog_signature(settings.datadog_api_key, x_datadog_signature, raw_body)
    except SignatureVerificationError as e:
        raise HTTPException(status_code=401, detail=str(e))

    payload = json.loads(raw_body)
    alert = normalize_datadog(payload)
    incident = await _create_incident(db, alert)
    await db.commit()
    background_tasks.add_task(_enqueue_investigation, incident.id)
    return {"ok": True, "incident_id": incident.id}


@router.post("/grafana")
async def grafana_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    x_grafana_signature: str = Header(default="", alias="X-Grafana-Signature"),
):
    raw_body = (await request.body()).decode()
    try:
        verify_grafana_signature(
            settings.grafana_webhook_secret, x_grafana_signature, raw_body
        )
    except SignatureVerificationError as e:
        raise HTTPException(status_code=401, detail=str(e))

    payload = json.loads(raw_body)
    # Grafana can send multiple alerts in one payload
    alerts_data = payload.get("alerts", [payload])
    incident_ids = []

    for alert_item in alerts_data:
        single_payload = {**payload, "alerts": [alert_item]}
        alert = normalize_grafana(single_payload)
        if alert.title:
            incident = await _create_incident(db, alert)
            incident_ids.append(incident.id)

    await db.commit()
    for iid in incident_ids:
        background_tasks.add_task(_enqueue_investigation, iid)

    return {"ok": True, "incidents": incident_ids}
