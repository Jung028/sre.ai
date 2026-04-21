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
from app.services.alert_correlator import AlertCorrelator
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


async def _get_or_create_incident(
    db: AsyncSession,
    alert: NormalizedAlert,
) -> tuple[Incident, bool]:
    """
    Correlate the alert against recent open incidents.
    If correlation score >= threshold, attach this alert to the existing incident
    and return (existing_incident, False) — no new investigation needed.
    Otherwise create a new incident and return (new_incident, True).
    """
    correlator = AlertCorrelator(db)
    match = await correlator.find_correlated(
        title=alert.title,
        service_name=alert.service_name,
        fired_at=alert.fired_at,
    )

    if match is not None:
        existing_incident, score = match
        # Attach this alert to the existing incident as a correlated alert
        db_alert = Alert(
            id=str(uuid.uuid4()),
            incident_id=existing_incident.id,
            source=alert.source,
            title=alert.title,
            description=alert.description,
            labels={
                **alert.labels,
                "_correlated": "true",
                "_correlation_score": str(round(score, 3)),
                "_correlation_strength": correlator.summarize_correlation(score),
            },
            fired_at=alert.fired_at,
        )
        db.add(db_alert)
        await db.flush()
        return existing_incident, False

    # No correlation found — create a new incident
    incident = await _create_incident(db, alert)
    return incident, True


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


def _enqueue_investigation(incident_id: str):
    from app.workers.tasks import investigate_alert_task
    investigate_alert_task.delay(incident_id)


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
    correlated_ids = []

    for msg in payload.get("messages", [payload]):
        event = msg.get("event", msg)
        if event.get("event_type", "") not in ("incident.triggered", "incident.acknowledged", ""):
            continue
        alert = normalize_pagerduty(event)
        incident, is_new = await _get_or_create_incident(db, alert)
        if is_new:
            incident_ids.append(incident.id)
        else:
            correlated_ids.append(incident.id)

    await db.commit()
    for iid in incident_ids:
        background_tasks.add_task(_enqueue_investigation, iid)

    return {"ok": True, "incidents": incident_ids, "correlated_to": correlated_ids}


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
    incident, is_new = await _get_or_create_incident(db, alert)
    await db.commit()

    if is_new:
        background_tasks.add_task(_enqueue_investigation, incident.id)
        return {"ok": True, "incident_id": incident.id, "correlated": False}

    return {
        "ok": True,
        "incident_id": incident.id,
        "correlated": True,
        "message": "Alert correlated to existing incident — no duplicate investigation started",
    }


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
    correlated_ids = []

    for alert_item in alerts_data:
        single_payload = {**payload, "alerts": [alert_item]}
        alert = normalize_grafana(single_payload)
        if alert.title:
            incident, is_new = await _get_or_create_incident(db, alert)
            if is_new:
                incident_ids.append(incident.id)
            else:
                correlated_ids.append(incident.id)

    await db.commit()
    for iid in incident_ids:
        background_tasks.add_task(_enqueue_investigation, iid)

    return {"ok": True, "incidents": incident_ids, "correlated_to": correlated_ids}
