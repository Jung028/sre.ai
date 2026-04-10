"""
Core AI Investigation Engine.

Uses anthropic.AsyncAnthropic with a manual multi-turn tool-calling loop
to gather evidence and produce a structured Root Cause Analysis.
"""
import asyncio
import json
import re
import textwrap
import uuid
from pathlib import Path

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.events import (
    StreamEvent,
    error_event,
    result_event,
    thought_event,
    tool_end_event,
    tool_start_event,
)
from app.models.incident import Incident
from app.models.rca import Evidence, RCA
from app.services.alert_normalizer import NormalizedAlert
from app.services.log_fetcher import LogFetcher
from app.services.metrics_fetcher import MetricsFetcher

_SYSTEM_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "system_prompt.md"


class InvestigationEngine:
    def __init__(self, db: AsyncSession):
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model
        self.db = db
        self.log_fetcher = LogFetcher()
        self.metrics_fetcher = MetricsFetcher()

    async def investigate(
        self,
        incident: Incident,
        alert: NormalizedAlert,
        event_queue: asyncio.Queue,
    ) -> RCA:
        messages = self._build_initial_messages(alert)
        tools = self._get_tool_schemas()
        system_prompt = _SYSTEM_PROMPT_PATH.read_text()
        all_evidence: list[dict] = []

        try:
            for turn in range(settings.max_investigation_turns):
                response = await self.client.messages.create(
                    model=self.model,
                    max_tokens=8096,
                    system=system_prompt,
                    messages=messages,
                    tools=tools,
                )

                for block in response.content:
                    if hasattr(block, "text") and block.text:
                        await event_queue.put(thought_event(incident.id, block.text))

                if response.stop_reason == "end_turn":
                    rca_text = self._extract_text(response.content)
                    rca = await self._persist_rca(incident, rca_text, messages, all_evidence)
                    await event_queue.put(result_event(incident.id, rca_text, success=True))
                    return rca

                if response.stop_reason == "tool_use":
                    tool_results = []
                    for block in response.content:
                        if block.type != "tool_use":
                            continue
                        await event_queue.put(
                            tool_start_event(incident.id, block.name, block.input)
                        )
                        try:
                            result = await self._execute_tool(block.name, block.input)
                            success = True
                            result_str = (
                                json.dumps(result) if not isinstance(result, str) else result
                            )
                            all_evidence.append(
                                {
                                    "kind": _tool_to_kind(block.name),
                                    "source": _tool_to_source(block.name),
                                    "query": json.dumps(block.input),
                                    "content": result_str[:2000],
                                    "name": block.name,
                                }
                            )
                        except Exception as e:
                            result_str = f"Error executing {block.name}: {e}"
                            success = False

                        await event_queue.put(
                            tool_end_event(incident.id, block.name, success, result_str[:300])
                        )
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": result_str,
                            }
                        )

                    messages = messages + [
                        {"role": "assistant", "content": response.content},
                        {"role": "user", "content": tool_results},
                    ]

            # Max turns reached — produce partial RCA
            rca_text = "Investigation reached maximum turns. Partial analysis available."
            rca = await self._persist_rca(incident, rca_text, messages, all_evidence)
            await event_queue.put(result_event(incident.id, rca_text, success=False))
            return rca

        except Exception as e:
            await event_queue.put(error_event(incident.id, str(e)))
            raise

    async def _execute_tool(self, name: str, inputs: dict):
        match name:
            case "fetch_logs":
                return await self.log_fetcher.fetch(
                    service=inputs.get("service", ""),
                    query=inputs.get("query", ""),
                    start_time=inputs.get("start_time", ""),
                    end_time=inputs.get("end_time", ""),
                    limit=inputs.get("limit", 50),
                )
            case "fetch_metrics":
                return await self.metrics_fetcher.fetch(
                    metric=inputs.get("metric", ""),
                    service=inputs.get("service"),
                    start_time=inputs.get("start_time", ""),
                    end_time=inputs.get("end_time", ""),
                    aggregation=inputs.get("aggregation", "avg"),
                )
            case "get_recent_deployments":
                return await self._get_recent_deployments(
                    inputs.get("service", ""), inputs.get("hours_back", 24)
                )
            case "search_code":
                return await self._search_code(inputs.get("query", ""), inputs.get("repo"))
            case "fetch_runbook":
                return await self._get_runbook(inputs.get("service_name", ""))
            case _:
                return {"error": f"Unknown tool: {name}"}

    async def _get_recent_deployments(self, service: str, hours_back: int) -> dict:
        if not settings.github_token or not settings.github_repo:
            return {
                "_mock": True,
                "service": service,
                "commits": [
                    {
                        "sha": "a3f8b12",
                        "message": f"feat: increase {service} db pool size to 50",
                        "author": "dev@example.com",
                        "timestamp": "2026-04-10T10:02:00Z",
                    }
                ],
            }
        from github import Github

        gh = Github(settings.github_token)
        repo = gh.get_repo(settings.github_repo)
        from datetime import datetime, timedelta, timezone

        since = datetime.now(timezone.utc) - timedelta(hours=hours_back)
        commits = repo.get_commits(since=since)
        return {
            "service": service,
            "commits": [
                {
                    "sha": c.sha[:8],
                    "message": c.commit.message.split("\n")[0],
                    "author": c.commit.author.email,
                    "timestamp": c.commit.author.date.isoformat(),
                }
                for c in list(commits)[:20]
            ],
        }

    async def _search_code(self, query: str, repo: str | None) -> dict:
        if not settings.github_token:
            return {"_mock": True, "results": [], "query": query}
        from github import Github

        gh = Github(settings.github_token)
        search_query = query
        if repo:
            search_query = f"{query} repo:{repo}"
        elif settings.github_repo:
            search_query = f"{query} repo:{settings.github_repo}"

        results = gh.search_code(search_query)
        return {
            "query": query,
            "results": [
                {
                    "path": r.path,
                    "repo": r.repository.full_name,
                    "snippet": r.decoded_content.decode()[:500] if r.decoded_content else "",
                }
                for r in list(results)[:10]
            ],
        }

    async def _get_runbook(self, service_name: str) -> dict:
        from sqlalchemy import select

        from app.models.runbook import Runbook

        result = await self.db.execute(
            select(Runbook).where(Runbook.service_name == service_name)
        )
        runbook = result.scalar_one_or_none()
        if runbook:
            return {"service": service_name, "content": runbook.content}
        return {"service": service_name, "content": None, "note": "No runbook found"}

    async def _persist_rca(
        self,
        incident: Incident,
        rca_text: str,
        messages: list,
        evidence_items: list[dict],
    ) -> RCA:
        parsed = self._parse_rca(rca_text)

        rca = RCA(
            id=str(uuid.uuid4()),
            incident_id=incident.id,
            root_cause=parsed.get("root_cause", "Unknown"),
            summary=parsed.get("summary", rca_text),
            confidence=parsed.get("confidence", "low"),
            hypothesis=None,
            timeline=parsed.get("timeline", []),
            recommended_actions=parsed.get("recommended_actions", []),
            needs_pr=parsed.get("needs_pr", False),
            pr_description=parsed.get("pr_description"),
            model_used=self.model,
            raw_messages=[
                m if isinstance(m, dict) else {"role": "assistant", "content": str(m)}
                for m in messages
            ],
        )
        self.db.add(rca)
        await self.db.flush()

        for ev in evidence_items:
            self.db.add(
                Evidence(
                    id=str(uuid.uuid4()),
                    rca_id=rca.id,
                    kind=ev["kind"],
                    source=ev["source"],
                    query=ev["query"],
                    content=ev["content"],
                    significance=f"Retrieved by {ev['name']}",
                )
            )

        # Update incident status
        incident.status = "needs_pr" if rca.needs_pr else "investigated"
        await self.db.commit()

        # Trigger runbook generation in background
        asyncio.create_task(self._generate_runbook(incident.service_name or "", rca))

        return rca

    async def _generate_runbook(self, service_name: str, rca: RCA) -> None:
        if not service_name:
            return
        from sqlalchemy import select

        from app.models.runbook import Runbook

        result = await self.db.execute(
            select(Runbook).where(Runbook.service_name == service_name)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return  # already have one

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2048,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Based on this RCA, generate a concise runbook for {service_name}:\n\n"
                            f"Root cause: {rca.root_cause}\n\n"
                            f"Recommended actions:\n{json.dumps(rca.recommended_actions, indent=2)}\n\n"
                            "Format as markdown with: ## Symptoms, ## Diagnosis Steps, ## Remediation"
                        ),
                    }
                ],
            )
            content = response.content[0].text if response.content else ""
            runbook = Runbook(
                id=str(uuid.uuid4()),
                service_name=service_name,
                content=content,
                source="generated",
                generated_from_rca_id=rca.id,
            )
            self.db.add(runbook)
            await self.db.commit()
        except Exception:
            pass  # Runbook generation is best-effort

    def _build_initial_messages(self, alert: NormalizedAlert) -> list[dict]:
        from datetime import timedelta

        window_start = (alert.fired_at - timedelta(hours=1)).isoformat()
        window_end = "now"

        context = textwrap.dedent(f"""
            ## Production Incident Alert

            **Source**: {alert.source}
            **Service**: {alert.service_name or "unknown"}
            **Severity**: {alert.severity}
            **Title**: {alert.title}
            **Description**: {alert.description or "No description provided"}
            **Fired At**: {alert.fired_at.isoformat()}
            **Labels**: {json.dumps(alert.labels, indent=2)}
            **Runbook URL**: {alert.runbook_url or "None"}

            Investigation window: {window_start} to {window_end}

            Begin your investigation. Start with `get_recent_deployments` and `fetch_metrics`.
        """).strip()

        return [{"role": "user", "content": context}]

    def _extract_text(self, content: list) -> str:
        return "\n".join(
            block.text for block in content if hasattr(block, "text") and block.text
        )

    def _parse_rca(self, text: str) -> dict:
        match = re.search(r"<rca>(.*?)</rca>", text, re.DOTALL)
        if not match:
            return {
                "root_cause": "Unable to determine root cause",
                "confidence": "low",
                "summary": text,
                "timeline": [],
                "recommended_actions": [],
                "needs_pr": False,
            }
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            return {
                "root_cause": "RCA parse error",
                "confidence": "low",
                "summary": text,
                "timeline": [],
                "recommended_actions": [],
                "needs_pr": False,
            }

    def _get_tool_schemas(self) -> list[dict]:
        return [
            {
                "name": "fetch_logs",
                "description": (
                    "Fetch application logs from Datadog. Use this to find errors, exceptions, "
                    "and anomalies. Get aggregate counts before fetching raw log samples."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string", "description": "Service name (e.g. 'payment-service')"},
                        "query": {"type": "string", "description": "Log query filter (e.g. 'status:error')"},
                        "start_time": {"type": "string", "description": "ISO8601 start time or relative (e.g. 'now-2h')"},
                        "end_time": {"type": "string", "description": "ISO8601 end time or 'now'"},
                        "limit": {"type": "integer", "description": "Max log lines (default 50, max 200)", "default": 50},
                    },
                    "required": ["service"],
                },
            },
            {
                "name": "fetch_metrics",
                "description": (
                    "Fetch time-series metrics (error rate, latency, throughput). "
                    "PREFER this over fetch_logs for initial investigation."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string", "description": "Metric name (e.g. 'trace.http.request.duration', 'system.cpu.user')"},
                        "service": {"type": "string", "description": "Service name filter"},
                        "start_time": {"type": "string"},
                        "end_time": {"type": "string"},
                        "aggregation": {
                            "type": "string",
                            "enum": ["avg", "max", "p95", "p99", "sum", "count"],
                            "default": "avg",
                        },
                    },
                    "required": ["metric"],
                },
            },
            {
                "name": "get_recent_deployments",
                "description": (
                    "Get recent Git commits/deployments for a service. "
                    "ALWAYS call this — most outages correlate with a recent deploy."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string", "description": "Service or repo name"},
                        "hours_back": {"type": "integer", "description": "Hours to look back", "default": 24},
                    },
                    "required": ["service"],
                },
            },
            {
                "name": "search_code",
                "description": "Search GitHub codebase for a specific function, error message, or pattern.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "GitHub code search query"},
                        "repo": {"type": "string", "description": "owner/repo (optional, defaults to configured repo)"},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "fetch_runbook",
                "description": "Retrieve the runbook for a service if one exists from prior incidents.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service_name": {"type": "string"},
                    },
                    "required": ["service_name"],
                },
            },
        ]


def _tool_to_kind(name: str) -> str:
    return {
        "fetch_logs": "log",
        "fetch_metrics": "metric",
        "get_recent_deployments": "deployment",
        "search_code": "code",
        "fetch_runbook": "runbook",
    }.get(name, "unknown")


def _tool_to_source(name: str) -> str:
    return {
        "fetch_logs": "datadog",
        "fetch_metrics": "datadog",
        "get_recent_deployments": "github",
        "search_code": "github",
        "fetch_runbook": "internal",
    }.get(name, "unknown")
