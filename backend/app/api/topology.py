"""Service topology graph endpoint."""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.incident import Incident

router = APIRouter(prefix="/topology", tags=["topology"])


@router.get("")
async def get_topology(db: AsyncSession = Depends(get_db)):
    """
    Returns service topology graph as nodes + edges.
    Derived from incident history.
    """
    result = await db.execute(
        select(
            Incident.service_name,
            func.count(Incident.id).label("incident_count"),
            func.max(Incident.severity).label("max_severity"),
            func.max(Incident.status).label("latest_status"),
        )
        .where(Incident.service_name.isnot(None))
        .group_by(Incident.service_name)
    )
    rows = result.all()

    nodes = [
        {
            "id": row.service_name,
            "label": row.service_name,
            "incident_count": row.incident_count,
            "severity": row.max_severity,
            "status": "healthy" if row.latest_status == "resolved" else "warning",
        }
        for row in rows
    ]

    # Edges derived from co-occurring incidents (same time window)
    # For MVP: return empty edges (manual topology config via env var can be added later)
    return {"nodes": nodes, "edges": []}
