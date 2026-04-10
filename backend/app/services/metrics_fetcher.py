"""Datadog / Grafana metrics fetcher with mock fallback."""
import httpx

from app.config import settings


class MetricsFetcher:
    def __init__(self):
        self._use_mock = not settings.datadog_api_key and not settings.grafana_url

    async def fetch(
        self,
        metric: str,
        service: str | None = None,
        start_time: str = "",
        end_time: str = "",
        aggregation: str = "avg",
    ) -> dict:
        if self._use_mock:
            return self._mock_metrics(metric, service)
        if settings.datadog_api_key:
            return await self._fetch_datadog(metric, service, start_time, end_time, aggregation)
        return await self._fetch_grafana(metric, service, start_time, end_time)

    async def _fetch_datadog(
        self, metric: str, service: str | None, start_time: str, end_time: str, aggregation: str
    ) -> dict:
        from datadog_api_client import ApiClient, Configuration
        from datadog_api_client.v2.api.metrics_api import MetricsApi

        configuration = Configuration()
        configuration.api_key["apiKeyAuth"] = settings.datadog_api_key
        configuration.api_key["appKeyAuth"] = settings.datadog_app_key

        query = f"{aggregation}:{metric}{{*}}"
        if service:
            query = f"{aggregation}:{metric}{{service:{service}}}"

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.{settings.datadog_site}/api/v1/query",
                params={"query": query, "from": start_time or "now-2h", "to": end_time or "now"},
                headers={
                    "DD-API-KEY": settings.datadog_api_key,
                    "DD-APPLICATION-KEY": settings.datadog_app_key,
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()

        series = data.get("series", [])
        if not series:
            return {"metric": metric, "service": service, "points": [], "avg": 0, "max": 0}

        points = series[0].get("pointlist", [])
        values = [p[1] for p in points if p[1] is not None]
        return {
            "metric": metric,
            "service": service,
            "query": query,
            "points": points[:200],
            "avg": sum(values) / len(values) if values else 0,
            "max": max(values) if values else 0,
        }

    async def _fetch_grafana(
        self, metric: str, service: str | None, start_time: str, end_time: str
    ) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.grafana_url}/api/ds/query",
                headers={"Authorization": f"Bearer {settings.grafana_api_key}"},
                json={
                    "queries": [{"expr": metric, "refId": "A"}],
                    "from": start_time or "now-2h",
                    "to": end_time or "now",
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            return {"metric": metric, "service": service, "raw": resp.json()}

    def _mock_metrics(self, metric: str, service: str | None) -> dict:
        # Simulate a spike starting at 10:05
        base_points = [
            [1744279200000 + i * 60000, 0.5 + (i * 0.1 if i < 5 else 15.0 if i < 15 else 12.0)]
            for i in range(30)
        ]
        values = [p[1] for p in base_points]
        return {
            "metric": metric,
            "service": service,
            "query": f"avg:{metric}{{service:{service}}}",
            "points": base_points,
            "avg": round(sum(values) / len(values), 2),
            "max": round(max(values), 2),
            "_mock": True,
            "_note": "Mock data showing spike at t+5min (deploy correlation)",
        }
