"""
Core AI Investigation Engine.

Uses a multi-agent orchestration system: specialist agents (Metrics, Logs,
Code, Kubernetes, Infrastructure) run focused investigations in parallel, then
a master Claude loop synthesizes all findings into a structured RCA.
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
from app.services.blast_radius import BlastRadiusAnalyzer
from app.services.log_fetcher import LogFetcher
from app.services.log_sampler import LogSampler
from app.services.metrics_fetcher import MetricsFetcher
from app.services.multi_agent import AgentOrchestrator

_SYSTEM_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "system_prompt.md"


class InvestigationEngine:
    def __init__(self, db: AsyncSession):
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model
        self.db = db
        self.log_fetcher = LogFetcher()
        self.log_sampler = LogSampler()
        self.metrics_fetcher = MetricsFetcher()

    async def investigate(
        self,
        incident: Incident,
        alert: NormalizedAlert,
        event_queue: asyncio.Queue,
    ) -> RCA:
        system_prompt = _SYSTEM_PROMPT_PATH.read_text()
        all_evidence: list[dict] = []

        try:
            # ── Phase 1: Blast Radius Analysis ───────────────────────────────
            blast_radius: dict = {}
            if incident.service_name:
                await event_queue.put(
                    thought_event(incident.id, "🔍 **Blast Radius** — mapping service dependency impact...")
                )
                try:
                    analyzer = BlastRadiusAnalyzer(self.db)
                    blast_radius = await analyzer.analyze(incident.service_name)
                    await event_queue.put(
                        thought_event(
                            incident.id,
                            f"💥 Blast radius: {blast_radius.get('blast_radius_size', 0)} affected services "
                            f"(risk: {blast_radius.get('risk_level', 'unknown')})",
                        )
                    )
                except Exception as e:
                    await event_queue.put(
                        thought_event(incident.id, f"⚠️ Blast radius analysis skipped: {e}")
                    )

            # ── Phase 2: Multi-Agent Investigation ───────────────────────────
            orchestrator = AgentOrchestrator(incident.id, event_queue)
            multi_agent_result = await orchestrator.investigate(alert)

            # Collect evidence from all agents
            for ev in multi_agent_result.get("evidence", []):
                all_evidence.append({
                    "kind": _tool_to_kind(ev.get("tool", "")),
                    "source": _tool_to_source(ev.get("tool", "")),
                    "query": json.dumps(ev.get("input", {})),
                    "content": str(ev.get("result", ""))[:2000],
                    "name": ev.get("tool", "unknown"),
                })

            # ── Phase 3: Synthesis Loop ───────────────────────────────────────
            await event_queue.put(
                thought_event(incident.id, "🧠 **Synthesizer** — generating final RCA from agent findings...")
            )

            messages = self._build_initial_messages(alert, blast_radius, multi_agent_result)
            tools = self._get_tool_schemas()

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
            case "get_log_statistics":
                return await self.log_sampler.get_statistics(
                    service=inputs.get("service", ""),
                    window_minutes=inputs.get("window_minutes", 30),
                )
            case "sample_error_logs":
                return await self.log_sampler.sample_by_pattern(
                    service=inputs.get("service", ""),
                    pattern=inputs.get("pattern", ""),
                    limit=inputs.get("limit", 10),
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

    def _build_initial_messages(
        self,
        alert: NormalizedAlert,
        blast_radius: dict,
        multi_agent_result: dict,
    ) -> list[dict]:
        from datetime import timedelta

        window_start = (alert.fired_at - timedelta(hours=1)).isoformat()
        window_end = "now"

        # Format agent findings for synthesis context
        agent_findings_text = ""
        for finding in multi_agent_result.get("agent_findings", []):
            agent = finding.get("agent", "unknown").upper()
            summary = finding.get("summary", "").strip()
            evidence_count = finding.get("evidence_count", 0)
            error = finding.get("error")
            if error:
                agent_findings_text += f"\n**{agent} AGENT**: Error — {error}\n"
            elif summary:
                agent_findings_text += f"\n**{agent} AGENT** ({evidence_count} evidence items):\n{summary[:1000]}\n"

        # Format blast radius
        blast_radius_text = ""
        if blast_radius:
            blast_radius_text = textwrap.dedent(f"""
                ## Blast Radius Analysis
                - **Risk Level**: {blast_radius.get('risk_level', 'unknown')} (score: {blast_radius.get('risk_score', 0)}/100)
                - **Direct Dependents**: {', '.join(blast_radius.get('direct_dependents', [])) or 'none'}
                - **Transitive Impact**: {blast_radius.get('blast_radius_size', 0)} services in blast radius
                - **Full Blast Radius**: {', '.join(blast_radius.get('full_blast_radius', [])[:10]) or 'none'}
            """).strip()

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

            {blast_radius_text}

            ## Specialist Agent Findings

            The following specialist agents have already investigated this incident:
            {agent_findings_text if agent_findings_text else "No specialist findings available."}

            ## Your Task

            You are the master synthesizer. Review all specialist agent findings above and produce
            a comprehensive Root Cause Analysis. You may call additional tools if needed to fill
            gaps in the evidence. End your analysis with a structured RCA in this exact format:

            <rca>
            {{
              "root_cause": "...",
              "summary": "...",
              "confidence": "high|medium|low",
              "timeline": [...],
              "recommended_actions": [...],
              "needs_pr": false,
              "pr_description": null
            }}
            </rca>
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
                    "and anomalies. Prefer get_log_statistics first to understand volume."
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
                "name": "get_log_statistics",
                "description": (
                    "Get aggregate log statistics: counts by level, top error patterns, rate. "
                    "Call this BEFORE fetching raw logs to avoid context bloat."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string"},
                        "window_minutes": {"type": "integer", "default": 30},
                    },
                    "required": ["service"],
                },
            },
            {
                "name": "sample_error_logs",
                "description": "Get representative log samples for a specific error pattern.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string"},
                        "pattern": {"type": "string", "description": "Error keyword/pattern to filter on"},
                        "limit": {"type": "integer", "default": 10},
                    },
                    "required": ["service", "pattern"],
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
        "get_log_statistics": "log",
        "sample_error_logs": "log",
        "fetch_metrics": "metric",
        "get_recent_deployments": "deployment",
        "search_code": "code",
        "fetch_runbook": "runbook",
    }.get(name, "unknown")


def _tool_to_source(name: str) -> str:
    return {
        "fetch_logs": "datadog",
        "get_log_statistics": "datadog",
        "sample_error_logs": "datadog",
        "fetch_metrics": "datadog",
        "get_recent_deployments": "github",
        "search_code": "github",
        "fetch_runbook": "internal",
    }.get(name, "unknown")
