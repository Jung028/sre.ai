# sre.ai

AI-powered Site Reliability Engineer — investigates production alerts, produces root cause analysis, and opens fix PRs. Inspired by Deeptrace (YC F25).

## How it works

1. **Webhook** arrives from PagerDuty / Datadog / Grafana
2. **Celery worker** enqueues an investigation job
3. **Claude** (via `anthropic.AsyncAnthropic`) runs a multi-turn tool-calling loop:
   - `get_recent_deployments` → correlate with deploy history
   - `fetch_metrics` → error rate, latency, saturation
   - `fetch_logs` → targeted error log analysis
   - `search_code` → suspect function/file lookup
4. **RCA** posted to Slack thread + saved to database
5. **GitHub PR** opened automatically if a code fix is identified
6. **Next.js dashboard** streams the live investigation in real-time

## Quickstart

```bash
# 1. Copy env vars
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY

# 2. Start all services
docker-compose up

# 3. Run DB migrations
docker-compose exec backend alembic upgrade head

# 4. Test with a fake alert
curl -X POST http://localhost:8000/api/webhooks/pagerduty \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"event":{"event_type":"incident.triggered","data":{"id":"test-001","title":"High error rate on payment-service","severity":"critical","service":{"summary":"payment-service"}}}}]}'

# 5. Open dashboard
open http://localhost:3000
```

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11, SQLAlchemy async |
| AI | Claude claude-sonnet-4-6 (Anthropic SDK) |
| Queue | Celery + Redis |
| DB | PostgreSQL |
| Integrations | PagerDuty, Datadog, Grafana, Slack, GitHub |

## Project structure

```
sre.ai/
├── backend/
│   ├── main.py                         FastAPI entrypoint
│   └── app/
│       ├── services/investigation_engine.py  ← Core AI agent loop
│       ├── workers/tasks.py                  ← Celery task
│       ├── api/webhooks.py                   ← Alert ingestion
│       └── prompts/system_prompt.md          ← Agent system prompt
└── frontend/
    └── src/app/incidents/              Active incidents + live RCA stream
```

## Environment variables

See `.env.example`. Only `ANTHROPIC_API_KEY`, `DATABASE_URL`, and `REDIS_URL` are required — all integrations (Datadog, Slack, GitHub) have mock fallbacks for local development.