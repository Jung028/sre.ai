"""Datadog logs fetcher with mock fallback for local development."""
import json
import os
from datetime import datetime

from app.config import settings


class LogFetcher:
    def __init__(self):
        self._use_mock = not settings.datadog_api_key

    async def fetch(
        self,
        service: str,
        query: str = "",
        start_time: str = "",
        end_time: str = "",
        limit: int = 50,
    ) -> dict:
        if self._use_mock:
            return self._mock_logs(service, query, limit)
        return await self._fetch_datadog(service, query, start_time, end_time, limit)

    async def _fetch_datadog(
        self, service: str, query: str, start_time: str, end_time: str, limit: int
    ) -> dict:
        from datadog_api_client import ApiClient, Configuration
        from datadog_api_client.v2.api.logs_api import LogsApi
        from datadog_api_client.v2.model.logs_list_request import LogsListRequest
        from datadog_api_client.v2.model.logs_list_request_page import LogsListRequestPage
        from datadog_api_client.v2.model.logs_query_filter import LogsQueryFilter
        from datadog_api_client.v2.model.logs_sort import LogsSort

        configuration = Configuration()
        configuration.api_key["apiKeyAuth"] = settings.datadog_api_key
        configuration.api_key["appKeyAuth"] = settings.datadog_app_key
        configuration.server_variables["site"] = settings.datadog_site

        base_query = f"service:{service}"
        if query:
            base_query = f"{base_query} {query}"

        with ApiClient(configuration) as api_client:
            api_instance = LogsApi(api_client)
            body = LogsListRequest(
                filter=LogsQueryFilter(
                    query=base_query,
                    _from=start_time or "now-2h",
                    to=end_time or "now",
                ),
                sort=LogsSort.TIMESTAMP_DESCENDING,
                page=LogsListRequestPage(limit=min(limit, 200)),
            )
            response = api_instance.list_logs(body=body)

        logs = []
        error_count = 0
        for log in response.data or []:
            attrs = log.attributes
            entry = {
                "timestamp": str(attrs.get("timestamp", "")),
                "level": attrs.get("status", ""),
                "message": str(attrs.get("message", ""))[:500],
                "service": attrs.get("service", service),
            }
            logs.append(entry)
            if entry["level"] in ("error", "critical", "fatal"):
                error_count += 1

        return {
            "service": service,
            "query": base_query,
            "total": len(logs),
            "error_count": error_count,
            "logs": logs[:limit],
        }

    def _mock_logs(self, service: str, query: str, limit: int) -> dict:
        mock_logs = [
            {
                "timestamp": "2026-04-10T10:05:12Z",
                "level": "error",
                "message": f"[{service}] Connection pool exhausted: max_connections=10 reached",
                "service": service,
            },
            {
                "timestamp": "2026-04-10T10:05:13Z",
                "level": "error",
                "message": f"[{service}] Failed to acquire DB connection after 5000ms timeout",
                "service": service,
            },
            {
                "timestamp": "2026-04-10T10:05:14Z",
                "level": "fatal",
                "message": f"[{service}] health check failed: upstream database unreachable",
                "service": service,
            },
            {
                "timestamp": "2026-04-10T10:04:58Z",
                "level": "info",
                "message": f"[{service}] Deploy v2.3.1 started",
                "service": service,
            },
        ]
        errors = [l for l in mock_logs if l["level"] in ("error", "fatal", "critical")]
        return {
            "service": service,
            "query": f"service:{service} {query}".strip(),
            "total": len(mock_logs),
            "error_count": len(errors),
            "logs": mock_logs[:limit],
            "_mock": True,
        }
