"""
Core AI Investigation Engine.

Uses Groq (OpenAI-compatible API) with a manual multi-turn tool-calling loop
to gather evidence and produce a structured Root Cause Analysis.
"""
import asyncio
import json
import re
import textwrap
import uuid
from pathlib import Path

from groq import AsyncGroq, BadRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.events import (
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
        self.client = AsyncGroq(api_key=settings.groq_api_key)
        self.model = settings.groq_model
        self.db = db
        self.log_fetcher = LogFetcher()
        self.metrics_fetcher = MetricsFetcher()

    async def investigate(
        self,
        incident: Incident,
        alert: NormalizedAlert,
        event_queue: asyncio.Queue,
    ) -> RCA:
        system_prompt = _SYSTEM_PROMPT_PATH.read_text()
        messages = [
            {"role": "system", "content": system_prompt},
            *self._build_initial_messages(alert),
        ]
        tools = self._get_tool_schemas()
        all_evidence: list[dict] = []

        try:
            for _turn in range(settings.max_investigation_turns):
                try:
                    response = await self.client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        tools=tools,
                        tool_choice="auto",
                        max_tokens=8096,
                    )
                except BadRequestError as e:
                    # Groq rejects malformed tool calls the model itself generated.
                    # Extract the failed_generation and parse it as a fallback.
                    tool_calls = _parse_failed_generation(e)
                    if not tool_calls:
                        raise
                    # Synthesise a fake response object we can continue with
                    response = _FakeResponse(tool_calls)

                choice = response.choices[0]
                msg = choice.message

                # Emit any text content as a thought event
                if msg.content:
                    await event_queue.put(thought_event(incident.id, msg.content))

                # Terminal — no more tool calls
                if choice.finish_reason == "stop" or not msg.tool_calls:
                    rca_text = msg.content or ""
                    rca = await self._persist_rca(incident, rca_text, messages, all_evidence)
                    await event_queue.put(result_event(incident.id, rca_text, success=True))
                    return rca

                # Append assistant message with tool_calls
                messages.append({
                    "role": "assistant",
                    "content": msg.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in msg.tool_calls
                    ],
                })

                # Execute each tool call
                for tc in msg.tool_calls:
                    name = tc.function.name
                    try:
                        inputs = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        inputs = {}

                    await event_queue.put(tool_start_event(incident.id, name, inputs))

                    try:
                        result = await self._execute_tool(name, inputs)
                        success = True
                        result_str = (
                            json.dumps(result) if not isinstance(result, str) else result
                        )
                        all_evidence.append(
                            {
                                "kind": _tool_to_kind(name),
                                "source": _tool_to_source(name),
                                "query": json.dumps(inputs),
                                "content": result_str[:2000],
                                "name": name,
                            }
                        )
                    except Exception as e:
                        result_str = f"Error executing {name}: {e}"
                        success = False

                    await event_queue.put(
                        tool_end_event(incident.id, name, success, result_str[:300])
                    )

                    # Append tool result message
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_str,
                    })

            # Max turns reached
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
            case "read_file":
                return await self._read_file(inputs.get("path", ""), inputs.get("repo"))
            case "list_repo_files":
                return await self._list_repo_files(inputs.get("directory", ""), inputs.get("repo"))
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
                        "timestamp": "2026-04-20T10:02:00Z",
                    }
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

    async def _read_file(self, path: str, repo: str | None) -> dict:
        """Read the actual content of a file from GitHub — gives Claude eyes on the code."""
        if not settings.github_token:
            return {"_mock": True, "path": path, "content": f"# Mock content for {path}\n# (set GITHUB_TOKEN to read real files)"}
        import asyncio
        return await asyncio.get_event_loop().run_in_executor(None, self._read_file_sync, path, repo)

    def _read_file_sync(self, path: str, repo: str | None) -> dict:
        from github import Github, GithubException
        gh = Github(settings.github_token)
        target = repo or settings.github_repo
        if not target:
            return {"error": "No repo configured. Set GITHUB_REPO in .env."}
        try:
            r = gh.get_repo(target)
            content = r.get_contents(path)
            if isinstance(content, list):
                return {"error": f"{path} is a directory — use list_repo_files instead"}
            text = content.decoded_content.decode("utf-8", errors="replace")
            return {"path": path, "repo": target, "content": text[:8000], "truncated": len(text) > 8000}
        except GithubException as e:
            return {"error": f"GitHub error: {e.data.get('message', str(e))}"}

    async def _list_repo_files(self, directory: str, repo: str | None) -> dict:
        """List files in a GitHub repo directory — helps Claude navigate the codebase."""
        if not settings.github_token:
            return {"_mock": True, "directory": directory, "files": ["src/main.py", "src/db/pool.py", "src/api/routes.py"]}
        import asyncio
        return await asyncio.get_event_loop().run_in_executor(None, self._list_files_sync, directory, repo)

    def _list_files_sync(self, directory: str, repo: str | None) -> dict:
        from github import Github, GithubException
        gh = Github(settings.github_token)
        target = repo or settings.github_repo
        if not target:
            return {"error": "No repo configured."}
        try:
            r = gh.get_repo(target)
            contents = r.get_contents(directory or "")
            if not isinstance(contents, list):
                contents = [contents]
            return {
                "directory": directory or "/",
                "repo": target,
                "files": [
                    {"name": c.name, "path": c.path, "type": c.type, "size": c.size}
                    for c in contents[:50]
                ],
            }
        except GithubException as e:
            return {"error": f"GitHub error: {e.data.get('message', str(e))}"}

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
        from sqlalchemy import select
        parsed = self._parse_rca(rca_text)

        # Upsert: update existing RCA if one already exists for this incident
        existing = (await self.db.execute(
            select(RCA).where(RCA.incident_id == incident.id)
        )).scalar_one_or_none()

        if existing:
            existing.root_cause = parsed.get("root_cause", "Unknown")
            existing.summary = parsed.get("summary", rca_text)
            existing.confidence = parsed.get("confidence", "low")
            existing.timeline = parsed.get("timeline", [])
            existing.recommended_actions = parsed.get("recommended_actions", [])
            existing.needs_pr = parsed.get("needs_pr", False)
            existing.pr_description = parsed.get("pr_description")
            existing.code_context = parsed.get("code_context")
            existing.model_used = self.model
            existing.raw_messages = [
                m if isinstance(m, dict) else {"role": "assistant", "content": str(m)}
                for m in messages
            ]
            await self.db.flush()
            rca = existing
        else:
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
                code_context=parsed.get("code_context"),
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

        incident.status = "needs_pr" if rca.needs_pr else "investigated"
        await self.db.commit()

        # Fire runbook generation with its own independent session (avoids shared-session race)
        service_name = incident.service_name or ""
        rca_id = rca.id
        root_cause = rca.root_cause
        actions = rca.recommended_actions
        asyncio.create_task(self._generate_runbook_isolated(service_name, rca_id, root_cause, actions))
        return rca

    async def _generate_runbook_isolated(
        self,
        service_name: str,
        rca_id: str,
        root_cause: str,
        recommended_actions: list,
    ) -> None:
        """Generate a runbook using its own DB session so it doesn't race the parent session."""
        if not service_name:
            return
        from sqlalchemy import select
        from app.database import AsyncSessionLocal
        from app.models.runbook import Runbook

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Runbook).where(Runbook.service_name == service_name)
                )
                if result.scalar_one_or_none():
                    return  # already have one

                response = await self.client.chat.completions.create(
                    model=self.model,
                    max_tokens=2048,
                    messages=[
                        {
                            "role": "user",
                            "content": (
                                f"Based on this RCA, generate a concise runbook for {service_name}:\n\n"
                                f"Root cause: {root_cause}\n\n"
                                f"Recommended actions:\n{json.dumps(recommended_actions, indent=2)}\n\n"
                                "Format as markdown with: ## Symptoms, ## Diagnosis Steps, ## Remediation"
                            ),
                        }
                    ],
                )
                content = response.choices[0].message.content or ""
                db.add(Runbook(
                    id=str(uuid.uuid4()),
                    service_name=service_name,
                    content=content,
                    source="generated",
                    generated_from_rca_id=rca_id,
                ))
                await db.commit()
        except Exception:
            pass  # best-effort

    def _build_initial_messages(self, alert: NormalizedAlert) -> list[dict]:
        from datetime import timedelta

        window_start = (alert.fired_at - timedelta(hours=1)).isoformat()

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

            Investigation window: {window_start} to now

            Begin your investigation. Start with `get_recent_deployments` and `fetch_metrics`.
        """).strip()

        return [{"role": "user", "content": context}]

    def _parse_rca(self, text: str) -> dict:
        match = re.search(r"<rca>(.*?)</rca>", text, re.DOTALL)
        if not match:
            # Try JSON block as fallback
            json_match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
            if json_match:
                try:
                    return json.loads(json_match.group(1))
                except json.JSONDecodeError:
                    pass
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
        """Return tools in OpenAI/Groq function-calling format."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "fetch_logs",
                    "description": (
                        "Fetch application logs from Datadog. Use this to find errors, exceptions, "
                        "and anomalies."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "service": {"type": "string", "description": "Service name (e.g. 'payment-service')"},
                            "query": {"type": "string", "description": "Log query filter (e.g. 'status:error')"},
                            "start_time": {"type": "string", "description": "ISO8601 start or relative (e.g. 'now-2h')"},
                            "end_time": {"type": "string", "description": "ISO8601 end time or 'now'"},
                            "limit": {"type": "integer", "description": "Max log lines (default 50)", "default": 50},
                        },
                        "required": ["service"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "fetch_metrics",
                    "description": (
                        "Fetch time-series metrics (error rate, latency, throughput). "
                        "PREFER this over fetch_logs for initial investigation."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "description": "Metric name (e.g. 'trace.http.request.duration')"},
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
            },
            {
                "type": "function",
                "function": {
                    "name": "get_recent_deployments",
                    "description": (
                        "Get recent Git commits/deployments for a service. "
                        "ALWAYS call this — most outages correlate with a recent deploy."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "service": {"type": "string", "description": "Service or repo name"},
                            "hours_back": {"type": "integer", "description": "Hours to look back", "default": 24},
                        },
                        "required": ["service"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "search_code",
                    "description": "Search GitHub codebase for a specific function, error message, or pattern.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "GitHub code search query"},
                            "repo": {"type": "string", "description": "owner/repo (optional)"},
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "fetch_runbook",
                    "description": "Retrieve the runbook for a service if one exists from prior incidents.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "service_name": {"type": "string"},
                        },
                        "required": ["service_name"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": (
                        "Read the full content of a source file from the GitHub repository. "
                        "Use this when search_code points to a specific file and you need to see "
                        "the actual implementation — connection pools, query builders, handlers, etc. "
                        "This gives you the exact code context needed to identify the root cause."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "File path in repo (e.g. 'src/db/pool.py')"},
                            "repo": {"type": "string", "description": "owner/repo override (optional — uses GITHUB_REPO if omitted)"},
                        },
                        "required": ["path"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_repo_files",
                    "description": (
                        "List files and directories in a path of the GitHub repository. "
                        "Use this to navigate the codebase structure when you need to find "
                        "where a service's code lives before calling read_file."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "directory": {"type": "string", "description": "Directory path (empty string = repo root)"},
                            "repo": {"type": "string", "description": "owner/repo override (optional)"},
                        },
                        "required": [],
                    },
                },
            },
        ]


def _parse_failed_generation(error: "BadRequestError") -> list | None:
    """
    Groq returns tool_use_failed when the model generates a malformed tool call.
    We've seen several formats in the wild — handle them all:

      Format A:  <function=NAME({"key": "val"})>
      Format B:  <function=NAME [{"key": "val"}]</function>
      Format C:  <function=NAME {"key": "val"}</function>
    """
    try:
        body = error.response.json()
        fg = body.get("error", {}).get("failed_generation", "")
        if not fg:
            return None

        # Match <function=NAME ...content... (</function> or >)
        outer = re.compile(
            r"<function=(\w+)\s*"       # <function=NAME (with optional space)
            r"([\[\({].*?)"             # opening bracket/paren — lazy
            r"(?:</function>|>)",       # closing tag or >
            re.DOTALL,
        )
        calls = []
        for idx, (name, raw_args) in enumerate(outer.findall(fg)):
            args_obj = _extract_json_object(raw_args.strip())
            args_str = json.dumps(args_obj) if args_obj is not None else "{}"
            calls.append(_FakeToolCall(id=f"fallback-{idx}", name=name, arguments=args_str))

        return calls if calls else None
    except Exception:
        return None


def _extract_json_object(s: str) -> dict | None:
    """
    Given a string that may be:
      - a JSON object:  {"k": "v"}
      - a JSON array containing one object:  [{"k": "v"}]
    Return the dict, or None on parse failure.
    """
    try:
        parsed = json.loads(s)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
            return parsed[0]
    except (json.JSONDecodeError, IndexError):
        # Try stripping trailing junk and retrying
        for end in (s.rfind("}") + 1, s.rfind("]") + 1):
            if end > 0:
                try:
                    return _extract_json_object(s[:end])
                except Exception:
                    pass
    return None


class _FakeFunction:
    def __init__(self, name: str, arguments: str):
        self.name = name
        self.arguments = arguments


class _FakeToolCall:
    def __init__(self, id: str, name: str, arguments: str):
        self.id = id
        self.type = "function"
        self.function = _FakeFunction(name, arguments)


class _FakeMessage:
    def __init__(self, tool_calls: list):
        self.content = None
        self.tool_calls = tool_calls


class _FakeChoice:
    def __init__(self, tool_calls: list):
        self.finish_reason = "tool_calls"
        self.message = _FakeMessage(tool_calls)


class _FakeResponse:
    def __init__(self, tool_calls: list):
        self.choices = [_FakeChoice(tool_calls)]


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
