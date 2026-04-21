"""
Blast Radius Analyzer
Determines which services are likely impacted by an incident
based on the service dependency topology.
"""
from collections import deque
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class BlastRadiusAnalyzer:
    """
    BFS traversal of the service dependency graph to find
    which services are upstream/downstream of the failing service.
    """

    MAX_HOPS = 3

    def __init__(self, db: AsyncSession):
        self.db = db

    async def analyze(self, service_name: str) -> dict:
        """
        Returns:
          - direct_dependencies: services this service calls
          - dependents: services that call this service (affected by its failure)
          - full_blast_radius: all transitively affected services
          - risk_score: 0-100 based on blast radius size
        """
        edges = await self._load_edges()

        # Build bidirectional adjacency lists
        calls: dict[str, set[str]] = {}  # service → services it calls
        called_by: dict[str, set[str]] = {}  # service → services that call it

        for source, target in edges:
            calls.setdefault(source, set()).add(target)
            called_by.setdefault(target, set()).add(source)

        # Direct
        direct_dependencies = list(calls.get(service_name, set()))
        direct_dependents = list(called_by.get(service_name, set()))

        # Transitive dependents (BFS upstream — who calls us transitively?)
        blast_radius = set()
        queue = deque([(service_name, 0)])
        visited = {service_name}

        while queue:
            svc, depth = queue.popleft()
            if depth >= self.MAX_HOPS:
                continue
            for upstream in called_by.get(svc, set()):
                if upstream not in visited:
                    visited.add(upstream)
                    blast_radius.add(upstream)
                    queue.append((upstream, depth + 1))

        # Risk score: size of blast radius normalized to 0-100
        total_services = len(set(s for e in edges for s in e))
        risk_score = min(100, int(len(blast_radius) / max(total_services, 1) * 100 + len(direct_dependents) * 10))

        return {
            "service": service_name,
            "direct_dependencies": direct_dependencies,
            "direct_dependents": direct_dependents,
            "full_blast_radius": list(blast_radius),
            "blast_radius_size": len(blast_radius),
            "risk_score": risk_score,
            "risk_level": "critical" if risk_score >= 60 else "high" if risk_score >= 30 else "medium" if risk_score >= 10 else "low",
        }

    async def _load_edges(self) -> list[tuple[str, str]]:
        """Load service dependency edges from DB or config."""
        import os
        import json

        # First try static config
        raw = os.getenv("TOPOLOGY_EDGES", "[]")
        try:
            edges = json.loads(raw)
            if edges:
                return [(e[0], e[1]) for e in edges]
        except Exception:
            pass

        # Fall back to trace-derived topology from DB
        try:
            from app.models.trace import TraceSpan
            result = await self.db.execute(
                select(TraceSpan.service, TraceSpan.parent_service)
                .where(TraceSpan.parent_service.isnot(None))
                .distinct()
                .limit(500)
            )
            return [(row.parent_service, row.service) for row in result]
        except Exception:
            return []
