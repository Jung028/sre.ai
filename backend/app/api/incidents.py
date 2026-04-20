from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.incident import Incident
from app.schemas.incident import IncidentOut, IncidentWithRCAOut

router = APIRouter(prefix="/incidents", tags=["incidents"])


class IncidentUpdate(BaseModel):
    status: str  # resolved | acknowledged | investigating


@router.get("", response_model=list[IncidentOut])
async def list_incidents(
    status: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    q = select(Incident).order_by(Incident.created_at.desc()).limit(limit)
    if status:
        q = q.where(Incident.status == status)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{incident_id}", response_model=IncidentWithRCAOut)
async def get_incident(incident_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.rca))
        .where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.patch("/{incident_id}", response_model=IncidentWithRCAOut)
async def update_incident(
    incident_id: str, body: IncidentUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.rca))
        .where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = body.status
    if body.status == "resolved" and incident.resolved_at is None:
        incident.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(incident)
    return incident


@router.get("/service/{service_name}", response_model=list[IncidentOut])
async def list_incidents_by_service(
    service_name: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Incident)
        .where(Incident.service_name == service_name)
        .order_by(Incident.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
