# sre.ai — Product Requirements & Solution Architecture

> **Version**: 1.0 · **Last Updated**: April 2026  
> **Stack**: Next.js 14 · FastAPI · PostgreSQL · Redis · Groq (llama-3.3-70b) · Slack · Discord · GitHub

---

## 1. What Is sre.ai?

sre.ai is an **AI-powered Site Reliability Engineering (SRE) platform** modelled on tools like [Deeptrace](https://deeptrace.ai) (YC F25). When a production alert fires — from PagerDuty, Datadog, Grafana, Slack, or Discord — sre.ai automatically:

1. Creates an incident record
2. Runs a multi-step AI investigation across logs, metrics, traces, deployments, and **your actual source code**
3. Produces a Root Cause Analysis (RCA) with a specific file path, code snippet, and suggested fix
4. Posts the full report to Slack/Discord
5. Optionally opens a GitHub Pull Request with the proposed fix
6. Auto-reviews every PR you open, catching production risks before merge

The goal: **cut MTTR (Mean Time to Resolution) from hours to minutes**.

---

## 2. Problem Statement

Traditional SRE workflows are slow and manual:

| Problem | Without sre.ai | With sre.ai |
|---|---|---|
| Alert fires at 3am | Engineer wakes up, logs in, manually checks Datadog | AI auto-investigates immediately |
| Root cause identification | 30–60 min of log tailing + guesswork | 2–5 min AI-driven analysis with exact file + line |
| Knowledge transfer | Runbooks get stale, tribe knowledge is siloed | RCA auto-generates/updates runbooks |
| PR risk | Code reviewer misses production-safety issues | Every PR auto-reviewed by AI before merge |
| Post-mortem | Manual doc written days later | RCA + timeline auto-generated at incident close |

---

## 3. User Stories

### SRE / On-call Engineer
- As an on-call engineer, I want to receive an instant RCA when an alert fires so I don't have to start from scratch at 3am
- As an SRE, I want to see the exact file + line number of the bug so I can fix it immediately
- As an SRE, I want runbooks to auto-update after each incident so tribal knowledge is preserved

### Developer
- As a developer, I want every PR I open to be automatically reviewed for production-safety risks
- As a developer, I want to trigger an investigation from Slack or Discord with `/agent investigate <description>`
- As a developer, I want to see a live stream of the AI investigation so I understand what it's checking

### Engineering Manager
- As a manager, I want a dashboard of all active and historical incidents
- As a manager, I want to see patterns (which services cause most incidents, what types of issues recur)
- As a manager, I want GitHub PRs automatically created for every incident so fixes are tracked

---

## 4. Features

### 4.1 Alert Ingestion
| Feature | Detail |
|---|---|
| **PagerDuty webhook** | `POST /api/webhooks/pagerduty` — receives `incident.triggered` events |
| **Datadog webhook** | `POST /api/webhooks/datadog` — receives monitor alert payloads |
| **Grafana webhook** | `POST /api/webhooks/grafana` — receives Grafana alert notifications |
| **Slack @mention** | `@sre-ai investigate payment-service` in any Slack channel |
| **Slack auto-detect** | Messages containing keywords (alert, outage, latency, p99...) auto-trigger |
| **Slack `/agent`** | `/agent investigate <description>` slash command |
| **Discord `/agent`** | Slash command: `/agent investigate`, `/agent status`, `/agent help` |
| **Discord auto-detect** | Bot monitors channels for alert keywords |
| **Manual** | `POST /api/webhooks/pagerduty` with custom payload for testing |

All sources normalise into a `NormalizedAlert` struct before reaching the investigation engine.

### 4.2 AI Investigation Engine
The heart of the system. Uses **Groq (llama-3.3-70b-versatile)** with a multi-turn tool-calling loop.

**Available Tools:**
| Tool | What It Does |
|---|---|
| `fetch_logs` | Pulls error logs from Datadog for the affected service |
| `fetch_metrics` | Gets p50/p95/p99 latency, error rate, throughput timeseries |
| `get_recent_deployments` | Lists recent GitHub commits — most outages correlate with a deploy |
| `search_code` | GitHub code search for suspicious functions or error messages |
| `read_file` | **Reads the actual source file** from GitHub — gives AI eyes on the code |
| `list_repo_files` | Navigates the repo structure to find relevant files |
| `fetch_runbook` | Retrieves stored runbooks from previous incidents |

**Investigation Loop:**
```
1. Build initial prompt from NormalizedAlert
2. Call Groq → model responds with tool_calls
3. Execute each tool (logs, metrics, GitHub API, etc.)
4. Feed tool results back to model
5. Repeat until model emits end_turn with <rca>...</rca> JSON
6. Parse RCA → persist to DB → post to Slack/Discord → optionally create GitHub PR
```

**RCA Output Schema:**
```json
{
  "root_cause": "ConnectionPool.acquire() blocks for 30s because pool_size=5 under 200 RPS",
  "confidence": "high",
  "summary": "## Investigation Summary\n...",
  "timeline": [{"ts": "2026-04-20T10:02Z", "event": "Deploy bumped max_connections"}],
  "recommended_actions": [
    {"priority": "immediate", "action": "Increase pool_size to 50 and restart"},
    {"priority": "short_term", "action": "Add connection pool metrics dashboard"}
  ],
  "code_context": {
    "file_path": "payment-service/src/db/pool.py",
    "class_name": "ConnectionPool",
    "function_name": "acquire",
    "line_number": 43,
    "snippet": "async def acquire(self):\n    return await asyncio.wait_for(self._pool.acquire(), timeout=30)",
    "suggested_fix": "async def acquire(self):\n    return await asyncio.wait_for(self._pool.acquire(), timeout=5)",
    "change_description": "Reduce acquire timeout from 30s to 5s and increase pool_size from 5 to 50"
  },
  "needs_pr": true,
  "pr_description": "Fix connection pool exhaustion causing payment service timeouts"
}
```

### 4.3 GitHub PR Auto-Review
Every PR opened in your repository is automatically reviewed by AI:

- Fetches the full diff via GitHub API
- Sends to Groq for structured analysis
- Posts a review back to the PR with:
  - Overall risk rating (HIGH / MEDIUM / LOW)
  - Specific issues with severity (critical → low)
  - Concrete fix suggestions
  - Good practices noted
  - Runbook notes for patterns observed

**Catches:**
- Security: injection, broken auth, exposed secrets
- Performance: N+1 queries, unbounded result sets, missing indexes
- Reliability: missing error handling, no timeouts, race conditions
- Observability: new code paths without logging/metrics
- Operational: risky migrations, missing feature flags

### 4.4 Live Investigation Stream
The dashboard shows a **live SSE stream** of the AI investigation as it happens:

```
→ fetch_logs(payment-service, "status:error")
← Found 1,243 errors in last 30 min: "connection pool exhausted"
→ get_recent_deployments(payment-service)
← 2 commits in last 24h: "refactor: reduce db pool size" (a3f8b12)
→ read_file(payment-service/src/db/pool.py)
← [file content] pool_size=5, timeout=30
→ [END] Root cause identified with high confidence
```

Events published to Redis pub/sub → FastAPI SSE endpoint → Next.js `EventSource`.

### 4.5 Multi-Channel Integration
| Channel | Trigger | Output |
|---|---|---|
| Slack | @mention, keyword auto-detect, `/agent` slash command | Thread reply with RCA + code snippet + fix |
| Discord | `/agent` slash command, keyword auto-detect | Rich embed with RCA + code fields |
| GitHub | PR opened/synced (webhook) | PR review comment with risk assessment |
| Dashboard | Always | Full RCA panel with 3-tab diff view |

### 4.6 Runbook Learning Loop
After each successful investigation:
1. AI generates a structured runbook from the RCA
2. Runbook stored in `runbooks` table keyed by service name
3. Next time the same service has an incident, `fetch_runbook` retrieves it
4. AI uses prior runbook context to investigate faster

### 4.7 Service Topology
Interactive graph (`/topology`) showing:
- Service dependency graph (static from `TOPOLOGY_EDGES` env var)
- Edges inferred from incidents that co-occurred within 5 minutes
- React Flow with zoom/pan/select
- Color-coded by incident severity

### 4.8 Distributed Traces
- `POST /api/traces` — ingest APM spans from your services
- `GET /api/traces` — list all traces
- Trace waterfall view (spans as horizontal bars, color per service)
- Trace map view (dependency graph from trace data)

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Alert Sources                            │
│  PagerDuty  Datadog  Grafana  Slack  Discord  Manual API        │
└────────────────────┬────────────────────────────────────────────┘
                     │ webhooks / events
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend (port 8000)                 │
│                                                                 │
│  /api/webhooks/*        ← PagerDuty / Datadog / Grafana        │
│  /api/slack/events      ← Slack Events API (@mention, message) │
│  /api/slack/commands    ← Slack /agent slash command           │
│  /api/discord/interactions ← Discord /agent slash command      │
│  /api/github/webhook    ← GitHub PR opened events              │
│                                                                 │
│  AlertNormalizer → NormalizedAlert                             │
│           │                                                     │
│           ▼                                                     │
│  InvestigationEngine (Groq multi-turn tool loop)               │
│    ├── fetch_logs       → Datadog Logs API (+ mock fallback)   │
│    ├── fetch_metrics    → Datadog/Grafana Metrics API          │
│    ├── get_recent_deployments → GitHub Commits API             │
│    ├── search_code      → GitHub Code Search                   │
│    ├── read_file        → GitHub Contents API                  │
│    ├── list_repo_files  → GitHub Contents API (dir listing)    │
│    └── fetch_runbook    → PostgreSQL runbooks table            │
│           │                                                     │
│           ▼                                                     │
│    RCA → PostgreSQL    Redis pub/sub (SSE stream)              │
│           │                    │                               │
│           ▼                    ▼                               │
│    SlackService         FastAPI SSE /api/incidents/{id}/stream │
│    DiscordAdapter       ChannelAdapter (unified interface)     │
│    GitHubService (PR)                                          │
│                                                                 │
│  PRReviewEngine         ← GitHub PR webhooks                   │
│    └── Groq diff analysis → GitHub PR Review API              │
└─────────────────────────────────────────────────────────────────┘
         │ SSE stream                    │ REST API
         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Next.js Frontend (port 3000)                  │
│                                                                 │
│  /incidents           — active incident list + severity badges  │
│  /incidents/[id]      — RCA panel + live SSE investigation log  │
│  /history             — resolved incidents table                │
│  /topology            — React Flow service dependency graph     │
│  /runbooks            — service runbook viewer                  │
│                                                                 │
│  RcaPanel             — root cause + confidence grid            │
│    CodeContextCard    — 3-tab: Problem | Fix | Diff             │
│    DiffBlock          — LCS-computed unified diff (GitHub-style)│
│  StreamingBubble      — live SSE event log                      │
│  TopologyGraph        — React Flow nodes + edges               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Models

### Incident
```
id            UUID (PK)
title         string
service_name  string
severity      enum: critical | high | medium | low
status        enum: investigating | investigated | resolved | false_alarm
source        string (pagerduty | datadog | grafana | slack | discord | manual)
external_id   string (from source system)
triggered_at  timestamp
resolved_at   timestamp (nullable)
slack_channel_id   string (nullable)
slack_thread_ts    string (nullable)
raw_payload   JSONB
```

### Alert
```
id            UUID (PK)
incident_id   UUID → Incident
source        string
title         string
description   text
labels        JSONB
fired_at      timestamp
```

### RCA
```
id                  UUID (PK)
incident_id         UUID → Incident (unique)
root_cause          text
confidence          enum: high | medium | low
summary             text (markdown)
timeline            JSONB array
recommended_actions JSONB array
needs_pr            bool
pr_description      text
github_pr_url       string (nullable)
code_context        JSONB (nullable)
  ├── file_path     string
  ├── class_name    string (nullable)
  ├── function_name string (nullable)
  ├── line_number   int (nullable)
  ├── snippet       text (problematic code)
  ├── suggested_fix text (fixed code)
  └── change_description text
raw_messages        JSONB (full conversation for debugging)
created_at          timestamp
updated_at          timestamp
```

### Runbook
```
id            UUID (PK)
service_name  string (unique)
content       text (markdown — generated by AI from RCA)
created_at    timestamp
updated_at    timestamp
```

### Trace + Span
```
Trace:
  id            UUID (PK)
  external_id   string (from APM system)
  service_name  string
  operation     string
  duration_ms   float
  status        enum: ok | error | slow
  started_at    timestamp

Span:
  id            UUID (PK)
  trace_id      UUID → Trace
  parent_id     UUID (nullable, self-ref)
  service       string
  operation     string
  start_ms      float (offset from trace start)
  duration_ms   float
  status        enum: ok | error | slow
  metadata      JSONB
```

---

## 7. API Reference

### Webhooks (no auth — HMAC verified internally)
| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/pagerduty` | PagerDuty v3 webhook |
| POST | `/api/webhooks/datadog` | Datadog monitor alert |
| POST | `/api/webhooks/grafana` | Grafana alert notification |
| POST | `/api/slack/events` | Slack Events API |
| POST | `/api/slack/commands` | Slack `/agent` slash command |
| POST | `/api/discord/interactions` | Discord `/agent` slash command |
| POST | `/api/github/webhook` | GitHub PR / push events |

### Incidents (API key auth when `API_KEY` is set)
| Method | Path | Description |
|---|---|---|
| GET | `/api/incidents` | List all incidents |
| GET | `/api/incidents/{id}` | Get single incident + RCA |
| PATCH | `/api/incidents/{id}` | Update status (acknowledge / resolve) |
| GET | `/api/incidents/{id}/stream` | SSE stream of live investigation events |

### Traces
| Method | Path | Description |
|---|---|---|
| POST | `/api/traces` | Ingest a trace + spans |
| GET | `/api/traces` | List traces |
| GET | `/api/traces/{trace_id}` | Get trace by external_id |

### Topology
| Method | Path | Description |
|---|---|---|
| GET | `/api/topology` | Get service topology (nodes + edges) |

### Runbooks
| Method | Path | Description |
|---|---|---|
| GET | `/api/runbooks` | List all runbooks |
| GET | `/api/runbooks/{service}` | Get runbook for a service |
| PUT | `/api/runbooks/{service}` | Create/update runbook |

### Utilities
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/discord/register-commands` | Register Discord `/agent` slash command |

---

## 8. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key (get at console.groq.com) |
| `GROQ_MODEL` | — | Model name (default: `llama-3.3-70b-versatile`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `API_KEY` | — | Shared API key for protected routes (empty = disabled) |
| `SLACK_BOT_TOKEN` | For Slack | `xoxb-...` from OAuth & Permissions |
| `SLACK_SIGNING_SECRET` | For Slack | From Basic Information → App Credentials |
| `SLACK_DEFAULT_CHANNEL` | For Slack | Default channel for alerts (e.g. `#incidents`) |
| `GITHUB_TOKEN` | For GitHub | Personal access token with `repo` scope |
| `GITHUB_REPO` | For GitHub | `owner/repo` of your codebase |
| `GITHUB_WEBHOOK_SECRET` | For PR review | HMAC secret set in GitHub webhook settings |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token from Discord Developer Portal |
| `DISCORD_APPLICATION_ID` | For Discord | Application ID from General Information |
| `DISCORD_PUBLIC_KEY` | For Discord | Ed25519 public key for signature verification |
| `PAGERDUTY_WEBHOOK_SECRET` | For PD | From PagerDuty webhook settings |
| `DATADOG_API_KEY` | For Datadog | Datadog API key |
| `DATADOG_APP_KEY` | For Datadog | Datadog application key |
| `GRAFANA_URL` | For Grafana | Grafana base URL |
| `GRAFANA_API_KEY` | For Grafana | Grafana service account token |
| `TOPOLOGY_EDGES` | — | JSON array: `[["api-gateway","auth-service"]]` |

---

## 9. Getting Started (Local Dev)

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### Quick Start

```bash
# 1. Clone and set up
git clone https://github.com/Jung028/sre.ai
cd sre.ai

# 2. Copy and fill env
cp .env.example .env
# Edit .env — at minimum set GROQ_API_KEY

# 3. Start infrastructure
docker-compose up postgres redis -d

# 4. Backend
cd backend
pip install -e .
# Symlink .env for pydantic-settings to find it
ln -sf ../.env .env
alembic upgrade head
uvicorn main:app --reload --port 8000

# 5. Frontend
cd ../frontend
npm install
npm run dev   # http://localhost:3000

# 6. Test it
python scripts/seed_mock_incident.py
```

### Run Everything with Docker
```bash
docker-compose up
# Frontend: http://localhost:3000
# Backend:  http://localhost:8000
# Docs:     http://localhost:8000/docs
```

---

## 10. Setting Up Integrations

### Slack Bot
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Scratch
2. **OAuth & Permissions** → Add scopes: `chat:write`, `channels:history`, `app_mentions:read`
3. Install to workspace → copy `Bot User OAuth Token` → `SLACK_BOT_TOKEN`
4. **Basic Information** → App Credentials → `Signing Secret` → `SLACK_SIGNING_SECRET`
5. **Event Subscriptions** → Enable → URL: `https://your-domain.com/api/slack/events`
   - Subscribe to: `app_mention`, `message.channels`
6. **Slash Commands** → Create `/agent`:
   - Request URL: `https://your-domain.com/api/slack/commands`
7. Invite bot to your `#incidents` channel

### Discord Bot
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → New Application
2. **Bot** tab → Add Bot → copy token → `DISCORD_BOT_TOKEN`
3. **General Information** → copy `Application ID` → `DISCORD_APPLICATION_ID`
4. **General Information** → copy `Public Key` → `DISCORD_PUBLIC_KEY`
5. **Bot** tab → Set **Interactions Endpoint URL**: `https://your-domain.com/api/discord/interactions`
6. Call `POST /api/discord/register-commands` to register `/agent` globally
7. **OAuth2** → URL Generator → scopes: `bot` + `applications.commands` → invite bot

### GitHub PR Review
1. Go to your repo → **Settings** → **Webhooks** → Add webhook
2. Payload URL: `https://your-domain.com/api/github/webhook`
3. Content type: `application/json`
4. Secret: set a strong string → `GITHUB_WEBHOOK_SECRET`
5. Events: select **Pull requests** and **Pushes**
6. Make sure `GITHUB_TOKEN` has `repo` write scope (to post reviews)

---

## 11. Project Structure

```
sre.ai/
├── .env.example                    ← Copy to .env, fill in credentials
├── docker-compose.yml              ← Postgres + Redis + Backend + Frontend
├── docs/
│   └── PRD_AND_ARCHITECTURE.md    ← This document
├── scripts/
│   ├── seed_mock_incident.py       ← Create a test incident
│   └── test_e2e.py                 ← End-to-end integration test
│
├── backend/
│   ├── main.py                     ← FastAPI app + router registration
│   ├── pyproject.toml              ← Python dependencies
│   ├── alembic/                    ← DB migration scripts
│   │   └── versions/
│   │       ├── 001_initial.py      ← incidents, alerts, rcas, runbooks
│   │       ├── 002_add_traces.py   ← traces, spans
│   │       └── 003_add_rca_code_context.py ← code_context JSONB column
│   └── app/
│       ├── config.py               ← All env vars via pydantic-settings
│       ├── database.py             ← Async SQLAlchemy engine + session
│       ├── models/                 ← SQLAlchemy ORM models
│       │   ├── incident.py         ← Incident, Alert
│       │   ├── rca.py              ← RCA (with code_context)
│       │   ├── runbook.py          ← Runbook
│       │   └── trace.py            ← Trace, Span
│       ├── schemas/                ← Pydantic request/response schemas
│       ├── api/                    ← FastAPI route handlers
│       │   ├── webhooks.py         ← PagerDuty / Datadog / Grafana
│       │   ├── incidents.py        ← CRUD + PATCH
│       │   ├── investigations.py   ← SSE stream
│       │   ├── topology.py         ← Service graph
│       │   ├── traces.py           ← APM trace ingestion
│       │   ├── runbooks.py         ← Runbook CRUD
│       │   ├── slack_events.py     ← Slack Events API + /agent command
│       │   ├── discord_events.py   ← Discord interactions + /agent
│       │   └── github_webhook.py   ← PR review trigger
│       ├── core/
│       │   ├── auth.py             ← API key middleware
│       │   └── events.py           ← SSE event helpers
│       ├── services/
│       │   ├── investigation_engine.py  ← Core AI loop (Groq + tools)
│       │   ├── pr_review_engine.py      ← AI PR reviewer
│       │   ├── channel_adapter.py       ← Slack + Discord unified output
│       │   ├── alert_normalizer.py      ← Multi-source normalization
│       │   ├── slack_service.py         ← Slack block kit formatting
│       │   ├── github_service.py        ← PR creation, code search
│       │   ├── log_fetcher.py           ← Datadog logs (+ mock)
│       │   └── metrics_fetcher.py       ← Datadog/Grafana metrics (+ mock)
│       ├── workers/
│       │   ├── celery_app.py       ← Celery configuration
│       │   └── tasks.py            ← investigate_alert_task
│       └── prompts/
│           ├── system_prompt.md    ← Master AI system prompt
│           └── rca_template.md     ← RCA output structure
│
└── frontend/
    ├── package.json
    └── src/
        ├── app/
        │   ├── incidents/
        │   │   ├── page.tsx        ← Incident list
        │   │   └── [id]/page.tsx   ← Incident detail + live stream
        │   ├── history/page.tsx    ← Resolved incidents
        │   ├── topology/page.tsx   ← Service graph
        │   └── runbooks/page.tsx   ← Runbook viewer
        ├── components/
        │   ├── investigation/
        │   │   ├── RcaPanel.tsx    ← RCA + 3-tab code diff
        │   │   ├── StreamingBubble.tsx ← Live SSE event log
        │   │   └── ChatInterface.tsx
        │   ├── topology/
        │   │   └── TopologyGraph.tsx ← React Flow graph
        │   ├── trace/
        │   │   ├── TraceWaterfall.tsx ← Span timeline
        │   │   └── TraceMap.tsx    ← Span dependency graph
        │   └── Sidebar.tsx         ← Navigation
        └── lib/
            ├── mockData.ts         ← Mock incidents/RCAs for dev
            ├── traceData.ts        ← Mock traces for dev
            ├── types.ts            ← TypeScript interfaces
            ├── api.ts              ← API client
            └── useIncidentStream.ts ← SSE EventSource hook
```

---

## 12. How the AI Investigation Works (Deep Dive)

### The Prompt
The system prompt (`backend/app/prompts/system_prompt.md`) tells the AI:
- It is a senior SRE with 10+ years experience
- It has access to specific tools
- It must always check recent deployments (most outages = recent deploy)
- It must always read the actual source file if search_code points to one
- It must output a structured `<rca>...</rca>` JSON block at the end

### Tool-Calling Loop
```python
messages = [system_prompt, initial_alert_message]

while True:
    response = await groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        tools=tool_schemas,
    )
    
    if response.choices[0].finish_reason == "stop":
        # Extract RCA from response text
        rca = parse_rca(response.choices[0].message.content)
        break
    
    # Execute tool calls
    for tool_call in response.choices[0].message.tool_calls:
        result = await execute_tool(tool_call.function.name, tool_call.function.arguments)
        messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})
        
        # Publish SSE event so frontend shows live progress
        await redis.publish(f"investigation:{incident_id}", json.dumps({
            "type": "tool_result", "tool": tool_call.function.name, "result": result
        }))
```

### Groq Tool-Calling Quirks
`llama-3.3-70b-versatile` occasionally generates malformed tool calls in the format `<function=NAME({...})>` instead of JSON. The engine has a `_parse_failed_generation()` fallback that:
1. Catches Groq `BadRequestError` (400)
2. Extracts the function name + args from the raw text using regex
3. Synthesizes a valid response object and continues the loop

### Code Repository Access
When the AI calls `search_code` and finds a file, it then calls `read_file` to see the actual implementation. This lets it:
- Identify the exact line causing the issue
- Understand the full context (class structure, imports, config)
- Generate a precise `code_context` with the specific snippet and fix

---

## 13. Channel Integration Deep Dive

### Slack Flow
```
Alert message → POST /api/slack/events (Events API)
             or POST /api/slack/commands (/agent slash command)
                      │
                      ▼
             _handle_slack_alert()
                      │
              Create Incident + Alert in DB
                      │
              Post "Investigating..." to thread
                      │
              Run InvestigationEngine
                      │
              SlackService.post_rca() → thread reply with:
                - Root cause block
                - Code snippet (before)
                - Suggested fix (after)
                - Recommended actions
                - PR link (if created)
```

### Discord Flow
```
/agent investigate → POST /api/discord/interactions
                             │
                    Respond immediately: type=5 (deferred)
                             │
                    Background: _run_investigation_discord()
                             │
                    Create Incident + Alert in DB
                             │
                    DiscordAdapter.post_investigating()
                             │
                    Run InvestigationEngine
                             │
                    DiscordAdapter.post_rca() → rich embed with:
                      - Root cause field
                      - Confidence field
                      - File location field
                      - Problematic code (fenced block)
                      - Suggested fix (fenced block)
                      - What to change
                      - Recommended actions
```

### GitHub PR Review Flow
```
PR opened → POST /api/github/webhook (GitHub webhook)
                      │
            PRReviewEngine.review_and_post()
                      │
            Fetch PR diff (all changed files, capped at 40 files)
                      │
            Groq analysis → structured JSON:
              { verdict, summary, overall_risk, issues[], praise[], learning_notes[] }
                      │
            Post GitHub PR Review with:
              - Overall risk badge
              - Per-issue findings (severity + type + file + fix)
              - Good practices
              - Runbook notes
```

---

## 14. Extending the Platform

### Add a New Alert Source
1. Add a route to `app/api/webhooks.py`
2. Implement normalization in `app/services/alert_normalizer.py` → return `NormalizedAlert`
3. Call `_run_investigation(incident_id)` after creating the incident

### Add a New AI Tool
1. Add the tool schema to `_get_tool_schemas()` in `investigation_engine.py`
2. Add a case to `_execute_tool()`
3. Implement the async method (with mock fallback for local dev)
4. Update `backend/app/prompts/system_prompt.md` to tell the AI when to use it

### Add a New Channel
1. Create a new adapter in `app/services/channel_adapter.py` implementing `ChannelAdapter`
2. Create a new API route handler (like `discord_events.py`)
3. Register the router in `main.py`

---

## 15. Key Design Decisions

| Decision | Rationale |
|---|---|
| **Groq instead of Anthropic** | Groq runs llama-3.3-70b at much lower cost and higher speed; tool-calling is good enough for SRE tasks |
| **No Celery for local dev** | Celery worker startup adds friction. In dev, investigations run as FastAPI background tasks. In prod (docker-compose), Celery workers are used. |
| **Mock fallbacks everywhere** | Datadog/GitHub APIs require credentials. Every tool has a `_mock` fallback so the system works locally without any external accounts. |
| **SSE over WebSockets** | SSE is simpler (unidirectional, works over HTTP/1.1, no upgrade handshake) and sufficient for streaming investigation events |
| **JSONB for code_context** | Schema evolves as we add more code context fields. JSONB avoids migrations for every iteration. |
| **Abstract ChannelAdapter** | Slack and Discord both receive the same investigation results. The adapter pattern means adding a new channel requires only one new class. |
| **Upsert RCA pattern** | If an investigation is re-run (e.g., after fixing a flaky tool), we update the existing RCA rather than creating a duplicate. |
| **Ed25519 for Discord** | Discord uses Ed25519 (not HMAC) for request verification. Requires PyNaCl. Verification is skipped in dev (no `DISCORD_PUBLIC_KEY` set). |

---

*Built for SREs who deserve to sleep through the night.*
