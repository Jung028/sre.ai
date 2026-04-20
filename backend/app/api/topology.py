"""Service topology graph endpoint."""
import json
from itertools import combinations

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.incident import Incident

router = APIRouter(prefix="/topology", tags=["topology"])

_FIVE_MINUTES = 5 * 60  # seconds


@router.get("")
async def get_topology(db: AsyncSession = Depends(get_db)):
    """
    Returns service topology graph as nodes + edges.
    Nodes are derived from incident history.
    Edges come from two sources:
      1. Static config via TOPOLOGY_EDGES env var (JSON list of [source, target] pairs).
      2. Inferred edges: services with incidents triggered within 5 minutes of each other.
    """
    # --- Nodes ---
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

    # --- Static edges from TOPOLOGY_EDGES env var ---
    try:
        raw_edges = json.loads(settings.topology_edges)
    except (json.JSONDecodeError, TypeError):
        raw_edges = []

    # Normalise: keep (source, target) as canonical key (lower-alpha sorted to avoid dupes)
    edge_map: dict[tuple[str, str], dict] = {}
    for pair in raw_edges:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            src, tgt = str(pair[0]), str(pair[1])
            key = (src, tgt)
            edge_map[key] = {"source": src, "target": tgt, "label": ""}

    # --- Inferred edges from co-occurring incidents ---
    inc_result = await db.execute(
        select(Incident.service_name, Incident.triggered_at)
        .where(Incident.service_name.isnot(None))
        .order_by(Incident.triggered_at)
    )
    incidents = inc_result.all()

    # Group by service: list of triggered_at timestamps (as epoch seconds)
    service_times: dict[str, list[float]] = {}
    for row in incidents:
        ts = row.triggered_at.timestamp()
        service_times.setdefault(row.service_name, []).append(ts)

    services = list(service_times.keys())
    for svc_a, svc_b in combinations(services, 2):
        times_a = service_times[svc_a]
        times_b = service_times[svc_b]
        found = False
        for ta in times_a:
            for tb in times_b:
                if abs(ta - tb) <= _FIVE_MINUTES:
                    found = True
                    break
            if found:
                break
        if found:
            key = (svc_a, svc_b)
            if key not in edge_map:
                edge_map[key] = {
                    "source": svc_a,
                    "target": svc_b,
                    "label": "",
                    "inferred": True,
                }

    return {"nodes": nodes, "edges": list(edge_map.values())}
