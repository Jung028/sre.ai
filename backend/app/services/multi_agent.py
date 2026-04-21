"""
Multi-Agent Orchestration System
Routes incidents to specialist agents and synthesizes findings into a master RCA.

Flow:
  1. Classify incident type from alert metadata
  2. Dispatch to relevant specialist agents (run in parallel where safe)
  3. Each specialist runs its own focused tool-calling loop
  4. Orchestrator synthesizes all specialist findings into final RCA
"""
import asyncio
import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import anthropic

from app.config import settings
from app.core.events import tool_start_event, tool_end_event, thought_event
from app.services.alert_normalizer import NormalizedAlert
from app.services.log_fetcher import LogFetcher
from app.services.metrics_fetcher import MetricsFetcher
from app.services.log_sampler import LogSampler


class AgentType(str, Enum):
    METRICS = "metrics"
    LOGS = "logs"
    CODE = "code"
    KUBERNETES = "kubernetes"
    DATABASE = "database"
    INFRASTRUCTURE = "infrastructure"


@dataclass
class AgentFinding:
    agent_type: AgentType
    summary: str
    evidence: list[dict] = field(default_factory=list)
    confidence: str = "medium"
    error: Optional[str] = None


class SpecialistAgent:
    """Base class for specialist agents. Each has focused tools and a domain prompt."""

    agent_type: AgentType
    emoji: str = "🔬"

    def __init__(self, incident_id: str, event_queue: asyncio.Queue):
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model
        self.incident_id = incident_id
        self.event_queue = event_queue
        self.log_fetcher = LogFetcher()
        self.metrics_fetcher = MetricsFetcher()
        self.log_sampler = LogSampler()

    def get_system_prompt(self) -> str:
        raise NotImplementedError

    def get_tools(self) -> list[dict]:
        raise NotImplementedError

    async def execute_tool(self, name: str, inputs: dict) -> str:
        raise NotImplementedError

    async def investigate(self, alert: NormalizedAlert) -> AgentFinding:
        """Run the agent's focused investigation loop."""
        await self.event_queue.put(
            thought_event(self.incident_id, f"{self.emoji} **{self.agent_type.value.title()} Agent** starting investigation...")
        )

        messages = [{"role": "user", "content": self._build_prompt(alert)}]
        tools = self.get_tools()
        system = self.get_system_prompt()
        evidence = []

        try:
            for _ in range(8):  # Max 8 turns per specialist
                response = await self.client.messages.create(
                    model=self.model,
                    max_tokens=4096,
                    system=system,
                    messages=messages,
                    tools=tools,
                )

                if response.stop_reason == "end_turn":
                    text = " ".join(b.text for b in response.content if hasattr(b, "text"))
                    return AgentFinding(
                        agent_type=self.agent_type,
                        summary=text,
                        evidence=evidence,
                        confidence="medium",
                    )

                if response.stop_reason == "tool_use":
                    tool_results = []
                    for block in response.content:
                        if block.type != "tool_use":
                            continue
                        await self.event_queue.put(
                            tool_start_event(self.incident_id, f"{self.emoji} {block.name}", block.input)
                        )
                        try:
                            result = await self.execute_tool(block.name, block.input)
                            result_str = result if isinstance(result, str) else json.dumps(result)
                            evidence.append({"tool": block.name, "input": block.input, "result": result_str[:1500]})
                            await self.event_queue.put(
                                tool_end_event(self.incident_id, block.name, True, result_str[:200])
                            )
                        except Exception as e:
                            result_str = f"Error: {e}"
                            await self.event_queue.put(
                                tool_end_event(self.incident_id, block.name, False, str(e)[:200])
                            )
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result_str,
                        })

                    messages = messages + [
                        {"role": "assistant", "content": response.content},
                        {"role": "user", "content": tool_results},
                    ]

        except Exception as e:
            return AgentFinding(agent_type=self.agent_type, summary="", error=str(e))

        return AgentFinding(agent_type=self.agent_type, summary="Max turns reached", evidence=evidence)

    def _build_prompt(self, alert: NormalizedAlert) -> str:
        return (
            f"Investigate this incident from your domain perspective.\n\n"
            f"Service: {alert.service_name or 'unknown'}\n"
            f"Alert: {alert.title}\n"
            f"Description: {alert.description or 'N/A'}\n"
            f"Severity: {alert.severity}\n"
            f"Fired at: {alert.fired_at.isoformat()}\n\n"
            f"Focus ONLY on your specialist domain. Be concise. "
            f"End with a 2-sentence finding summary prefixed with 'FINDING:'"
        )


class MetricsAgent(SpecialistAgent):
    agent_type = AgentType.METRICS
    emoji = "📊"

    def get_system_prompt(self) -> str:
        return (
            "You are a metrics specialist. Investigate error rates, latency percentiles (p50/p95/p99), "
            "throughput, and saturation metrics. Look for spikes, drops, and correlations with the alert time. "
            "Always check error rate AND latency — they often tell different stories."
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "fetch_metrics",
                "description": "Fetch time-series metrics: error_rate, request_duration, throughput, cpu_usage, memory_usage, db_connections",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string"},
                        "service": {"type": "string"},
                        "start_time": {"type": "string"},
                        "end_time": {"type": "string"},
                        "aggregation": {"type": "string", "enum": ["avg", "max", "p95", "p99", "sum", "count"], "default": "avg"},
                    },
                    "required": ["metric"],
                },
            },
            {
                "name": "detect_anomalies",
                "description": "Detect statistical anomalies in a metric over time using z-score analysis",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string"},
                        "service": {"type": "string"},
                        "window_hours": {"type": "integer", "default": 2},
                    },
                    "required": ["metric", "service"],
                },
            },
        ]

    async def execute_tool(self, name: str, inputs: dict) -> str:
        if name == "fetch_metrics":
            result = await self.metrics_fetcher.fetch(
                metric=inputs.get("metric", ""),
                service=inputs.get("service"),
                start_time=inputs.get("start_time", "now-2h"),
                end_time=inputs.get("end_time", "now"),
                aggregation=inputs.get("aggregation", "avg"),
            )
            return json.dumps(result)
        if name == "detect_anomalies":
            from app.services.anomaly_detector import AnomalyDetector
            detector = AnomalyDetector(self.metrics_fetcher)
            result = await detector.detect(
                metric=inputs["metric"],
                service=inputs["service"],
                window_hours=inputs.get("window_hours", 2),
            )
            return json.dumps(result)
        return json.dumps({"error": f"Unknown tool: {name}"})


class LogsAgent(SpecialistAgent):
    agent_type = AgentType.LOGS
    emoji = "📋"

    def get_system_prompt(self) -> str:
        return (
            "You are a log analysis specialist. Use statistics-first approach: "
            "1) Get log volume and error distribution first, "
            "2) Identify the top 3 error patterns, "
            "3) Sample representative examples of each. "
            "Look for stack traces, timeout messages, connection errors, and OOM kills."
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "get_log_statistics",
                "description": "Get aggregate log statistics: counts by level, top error types, volume over time. Call this FIRST.",
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
                "description": "Get representative log samples for a specific error pattern. Call AFTER get_log_statistics.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string"},
                        "pattern": {"type": "string", "description": "Error pattern/keyword to filter on"},
                        "limit": {"type": "integer", "default": 10},
                    },
                    "required": ["service", "pattern"],
                },
            },
        ]

    async def execute_tool(self, name: str, inputs: dict) -> str:
        if name == "get_log_statistics":
            result = await self.log_sampler.get_statistics(
                service=inputs["service"],
                window_minutes=inputs.get("window_minutes", 30),
            )
            return json.dumps(result)
        if name == "sample_error_logs":
            result = await self.log_sampler.sample_by_pattern(
                service=inputs["service"],
                pattern=inputs["pattern"],
                limit=inputs.get("limit", 10),
            )
            return json.dumps(result)
        return json.dumps({"error": f"Unknown tool: {name}"})


class CodeAgent(SpecialistAgent):
    agent_type = AgentType.CODE
    emoji = "💻"

    def get_system_prompt(self) -> str:
        return (
            "You are a code change specialist. Your first action MUST be get_recent_deployments — "
            "85% of incidents are caused by a recent deploy. Look for config changes, dependency bumps, "
            "or logic changes near the alert time. Then search for the specific code paths mentioned in errors."
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "get_recent_deployments",
                "description": "Get recent commits and deployments. ALWAYS call this first.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string"},
                        "hours_back": {"type": "integer", "default": 24},
                    },
                    "required": ["service"],
                },
            },
            {
                "name": "search_code",
                "description": "Search the codebase for a function, error message, or config key.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "repo": {"type": "string"},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "read_file",
                "description": "Read a specific source file from GitHub.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "repo": {"type": "string"},
                    },
                    "required": ["path"],
                },
            },
        ]

    async def execute_tool(self, name: str, inputs: dict) -> str:
        if name == "get_recent_deployments":
            result = await self._get_recent_deployments(inputs.get("service", ""), inputs.get("hours_back", 24))
            return json.dumps(result)
        if name == "search_code":
            result = await self._search_code(inputs.get("query", ""), inputs.get("repo"))
            return json.dumps(result)
        if name == "read_file":
            result = await self._read_file(inputs.get("path", ""), inputs.get("repo"))
            return json.dumps(result)
        return json.dumps({"error": f"Unknown tool: {name}"})

    async def _get_recent_deployments(self, service: str, hours_back: int) -> dict:
        if not settings.github_token or not settings.github_repo:
            return {
                "_mock": True,
                "service": service,
                "commits": [
                    {"sha": "a3f8b12", "message": f"chore: update {service} config", "author": "dev@example.com", "timestamp": "2026-04-10T10:02:00Z"},
                ],
            }
        from github import Github
        from datetime import datetime, timedelta, timezone
        gh = Github(settings.github_token)
        repo = gh.get_repo(settings.github_repo)
        since = datetime.now(timezone.utc) - timedelta(hours=hours_back)
        commits = repo.get_commits(since=since)
        return {
            "service": service,
            "commits": [
                {"sha": c.sha[:8], "message": c.commit.message.split("\n")[0], "author": c.commit.author.email, "timestamp": c.commit.author.date.isoformat()}
                for c in list(commits)[:20]
            ],
        }

    async def _search_code(self, query: str, repo: str | None) -> dict:
        if not settings.github_token:
            return {"_mock": True, "results": [], "query": query}
        from github import Github
        gh = Github(settings.github_token)
        q = f"{query} repo:{repo or settings.github_repo}" if (repo or settings.github_repo) else query
        results = gh.search_code(q)
        return {"query": query, "results": [{"path": r.path, "repo": r.repository.full_name, "snippet": (r.decoded_content.decode()[:500] if r.decoded_content else "")} for r in list(results)[:10]]}

    async def _read_file(self, path: str, repo: str | None) -> dict:
        if not settings.github_token:
            return {"_mock": True, "path": path, "content": "# File content not available (no GitHub token)"}
        from github import Github
        gh = Github(settings.github_token)
        r = gh.get_repo(repo or settings.github_repo)
        try:
            f = r.get_contents(path)
            return {"path": path, "content": f.decoded_content.decode()[:3000]}
        except Exception as e:
            return {"error": str(e), "path": path}


class KubernetesAgent(SpecialistAgent):
    agent_type = AgentType.KUBERNETES
    emoji = "☸️"

    def get_system_prompt(self) -> str:
        return (
            "You are a Kubernetes specialist. Check pod statuses, recent events, OOMKills, "
            "CrashLoopBackoffs, resource limits, and HPA scaling events. "
            "Look for: pods being evicted, resource pressure, readiness probe failures."
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "get_k8s_status",
                "description": "Get Kubernetes pod/deployment status for a service",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "service": {"type": "string"},
                        "namespace": {"type": "string", "default": "default"},
                    },
                    "required": ["service"],
                },
            },
        ]

    async def execute_tool(self, name: str, inputs: dict) -> str:
        if name == "get_k8s_status":
            # K8s integration — mock if kubectl/API not configured
            return json.dumps({
                "_mock": True,
                "service": inputs.get("service"),
                "namespace": inputs.get("namespace", "default"),
                "pods": [
                    {"name": f"{inputs.get('service')}-7d4f8b-xyz", "status": "Running", "restarts": 3, "age": "42m"},
                    {"name": f"{inputs.get('service')}-7d4f8b-abc", "status": "Running", "restarts": 0, "age": "42m"},
                ],
                "events": [
                    {"type": "Warning", "reason": "BackOff", "message": "Back-off restarting failed container", "count": 5},
                ],
                "note": "Connect kubectl via KUBECONFIG env var for real data",
            })
        return json.dumps({"error": f"Unknown tool: {name}"})


class InfrastructureAgent(SpecialistAgent):
    agent_type = AgentType.INFRASTRUCTURE
    emoji = "🏗️"

    def get_system_prompt(self) -> str:
        return (
            "You are an infrastructure specialist. Check system resources: "
            "CPU, memory, disk, network, and database connections. "
            "Look for resource saturation, connection pool exhaustion, and disk pressure."
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "fetch_metrics",
                "description": "Fetch infrastructure metrics: cpu_usage, memory_usage, disk_usage, db_connections, network_bytes",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string"},
                        "service": {"type": "string"},
                        "start_time": {"type": "string"},
                        "end_time": {"type": "string"},
                    },
                    "required": ["metric"],
                },
            },
        ]

    async def execute_tool(self, name: str, inputs: dict) -> str:
        if name == "fetch_metrics":
            result = await self.metrics_fetcher.fetch(
                metric=inputs.get("metric", ""),
                service=inputs.get("service"),
                start_time=inputs.get("start_time", "now-2h"),
                end_time=inputs.get("end_time", "now"),
            )
            return json.dumps(result)
        return json.dumps({"error": f"Unknown tool: {name}"})


def classify_alert(alert: NormalizedAlert) -> list[AgentType]:
    """
    Classify which specialist agents are relevant for this alert.
    Uses keyword matching on title + description + labels.
    Returns agents in priority order.
    """
    text = f"{alert.title} {alert.description or ''} {' '.join(alert.labels.values())}".lower()

    agents = []

    # Code agent: ALWAYS include — deploys cause ~85% of incidents
    agents.append(AgentType.CODE)

    # Metrics: any rate/latency/error alert
    if any(k in text for k in ["error rate", "latency", "p99", "p95", "timeout", "slow", "throughput", "request"]):
        agents.insert(0, AgentType.METRICS)

    # Logs: crashes, exceptions, fatal errors
    if any(k in text for k in ["exception", "fatal", "crash", "oom", "out of memory", "error", "failed", "panic"]):
        agents.insert(1 if AgentType.METRICS in agents else 0, AgentType.LOGS)

    # Kubernetes: pod/container/k8s issues
    if any(k in text for k in ["pod", "container", "k8s", "kubernetes", "deployment", "crashloop", "evict", "node"]):
        agents.append(AgentType.KUBERNETES)

    # Infrastructure: resource issues
    if any(k in text for k in ["cpu", "memory", "disk", "connection pool", "saturation", "capacity", "resource"]):
        agents.append(AgentType.INFRASTRUCTURE)

    # Always have at least 2 agents
    if len(agents) < 2:
        agents.append(AgentType.METRICS)

    return list(dict.fromkeys(agents))  # Deduplicate, preserve order


AGENT_CLASSES = {
    AgentType.METRICS: MetricsAgent,
    AgentType.LOGS: LogsAgent,
    AgentType.CODE: CodeAgent,
    AgentType.KUBERNETES: KubernetesAgent,
    AgentType.INFRASTRUCTURE: InfrastructureAgent,
}


class AgentOrchestrator:
    """
    Routes an incident to specialist agents and synthesizes findings into a master RCA.
    """

    def __init__(self, incident_id: str, event_queue: asyncio.Queue):
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model
        self.incident_id = incident_id
        self.event_queue = event_queue

    async def investigate(self, alert: NormalizedAlert) -> dict:
        """
        Run multi-agent investigation and return raw findings dict.
        The InvestigationEngine will use these to build the RCA.
        """
        agent_types = classify_alert(alert)

        await self.event_queue.put(
            thought_event(
                self.incident_id,
                f"🧠 **Orchestrator** routing to: {', '.join(t.value for t in agent_types)}"
            )
        )

        # Run agents — Code always first (serial), then others in parallel
        code_types = [t for t in agent_types if t == AgentType.CODE]
        parallel_types = [t for t in agent_types if t != AgentType.CODE]

        findings: list[AgentFinding] = []

        # Code agent first (sets context for others)
        for t in code_types:
            agent = AGENT_CLASSES[t](self.incident_id, self.event_queue)
            finding = await agent.investigate(alert)
            findings.append(finding)

        # Others in parallel
        if parallel_types:
            tasks = [
                AGENT_CLASSES[t](self.incident_id, self.event_queue).investigate(alert)
                for t in parallel_types
            ]
            parallel_results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in parallel_results:
                if isinstance(r, AgentFinding):
                    findings.append(r)

        return {"agent_findings": [
            {
                "agent": f.agent_type.value,
                "summary": f.summary,
                "evidence_count": len(f.evidence),
                "error": f.error,
            }
            for f in findings
        ], "evidence": [e for f in findings for e in f.evidence]}
