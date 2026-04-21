import type { Incident } from "./types";

export const TRACE_IDS: Record<string, string> = {
  "inc-001": "4bf92f3577b34da6a3ce929d0e0e4736",
  "inc-002": "a3c2b1d4e5f6789012345678abcdef01",
  "inc-003": "7f1e3d2c4b5a6978091234567890abcd",
  "inc-004": "b2c3d4e5f6a1789056789012345678ab",
  "inc-005": "9e8d7c6b5a4312f0abcdef0123456789",
};

export const MOCK_INCIDENTS: Incident[] = [
  {
    id: "inc-001",
    source: "pagerduty",
    external_id: "PD-3821",
    title: "High error rate on payment-service (23% → baseline 0.1%)",
    severity: "critical",
    status: "needs_pr",
    service_name: "payment-service",
    triggered_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    resolved_at: null,
    slack_thread_ts: "1744279500.123456",
    created_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    rca: {
      id: "rca-001",
      incident_id: "inc-001",
      root_cause:
        "Deploy v2.3.1 of payment-service set max_connections=5 (down from 50), exhausting the PostgreSQL connection pool under normal traffic load.",
      summary: `## Root Cause Analysis — payment-service High Error Rate

**Root Cause:** Deploy v2.3.1 introduced a misconfigured \`DATABASE_POOL_SIZE=5\` env var (changed from 50), exhausting the PostgreSQL connection pool under normal traffic.

### Evidence
- **Metrics:** Error rate spiked from 0.1% → 23% at \`10:05:00Z\`, precisely 3 minutes after the v2.3.1 deploy at \`10:02:00Z\`
- **Logs:** \`FATAL: remaining connection slots are reserved for replication\` appearing 847 times/min
- **Deploy history:** Commit \`a3f8b12\` — "chore: tune payment-service env vars" — reduced \`DATABASE_POOL_SIZE\` from 50 → 5
- **Code:** \`payment-service/config/database.py\` — pool size read from env var with no validation floor

### Timeline
| Time | Event |
|------|-------|
| 10:02:00Z | Deploy v2.3.1 rolled out (3 pods restarted) |
| 10:05:12Z | First connection pool exhaustion errors |
| 10:05:30Z | PagerDuty alert fired (error rate > 5%) |
| 10:08:00Z | sre.ai investigation complete |`,
      confidence: "high",
      timeline: [
        { ts: "2026-04-10T10:02:00Z", event: "Deploy v2.3.1 rolled out — 3 pods restarted" },
        { ts: "2026-04-10T10:05:12Z", event: "First connection pool exhaustion errors appear" },
        { ts: "2026-04-10T10:05:30Z", event: "PagerDuty alert fired (error rate > 5%)" },
        { ts: "2026-04-10T10:06:00Z", event: "Error rate peaks at 23%" },
        { ts: "2026-04-10T10:08:00Z", event: "AI investigation complete, PR created" },
      ],
      recommended_actions: [
        {
          priority: "immediate",
          action: "Roll back payment-service to v2.3.0",
          rationale: "Fastest path to restoring pool size to 50 connections",
        },
        {
          priority: "short_term",
          action: "Set DATABASE_POOL_SIZE=50 in production config and redeploy v2.3.1",
          rationale: "Fixes the misconfiguration while keeping other v2.3.1 changes",
        },
        {
          priority: "long_term",
          action: "Add pool size validation with minimum floor (e.g. min=10) and alerting on pool saturation",
          rationale: "Prevents silent misconfig causing cascading failures",
        },
      ],
      needs_pr: true,
      github_pr_url: "https://github.com/example/payment-service/pull/142",
      evidence: [
        { type: "metric", label: "Error Rate", value: "23%", delta: "0.1% → 23%", detail: "Spiked at 10:05:00Z, 3 min post-deploy" },
        { type: "log",    label: "Fatal Errors", value: "847/min", detail: "FATAL: remaining connection slots are reserved for replication" },
        { type: "deploy", label: "Deploy", value: "a3f8b12", detail: "chore: tune payment-service env vars · DATABASE_POOL_SIZE 50 → 5" },
        { type: "code",   label: "Root File", value: "pool.py:43", detail: "ConnectionPool.acquire() — no validation on MAX_CONNECTIONS" },
      ],
      model_used: "claude-sonnet-4-6",
      generated_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
      code_context: {
        file_path: "payment-service/src/db/pool.py",
        class_name: "ConnectionPool",
        function_name: "acquire",
        line_number: 43,
        snippet: `MAX_CONNECTIONS = 5  # BUG: was accidentally set to 5 (down from 50)\n\nasync def acquire(self):\n    if self._active >= MAX_CONNECTIONS:\n        raise PoolExhausted(f"All {MAX_CONNECTIONS} connections in use")\n    conn = await self._create_connection()\n    self._active += 1\n    return conn`,
        suggested_fix: `MAX_CONNECTIONS = int(os.getenv("DATABASE_POOL_SIZE", "50"))  # read from env, floor=10\nif MAX_CONNECTIONS < 10:\n    raise ValueError(f"DATABASE_POOL_SIZE={MAX_CONNECTIONS} is dangerously low (min 10)")\n\nasync def acquire(self, timeout: float = 30.0):\n    try:\n        async with asyncio.timeout(timeout):\n            while self._active >= MAX_CONNECTIONS:\n                await self._release_event.wait()\n    except asyncio.TimeoutError:\n        raise PoolExhausted("Connection wait timed out after 30s")\n    conn = await self._create_connection()\n    self._active += 1\n    return conn`,
        change_description: "Restore DATABASE_POOL_SIZE to 50, add env-var validation with a minimum floor of 10, and replace hard-fail with async wait + timeout so brief saturation is handled gracefully.",
      },
    },
  },
  {
    id: "inc-002",
    source: "datadog",
    external_id: "DD-59201",
    title: "auth-service p99 latency > 4000ms (SLO breach)",
    severity: "high",
    status: "investigated",
    service_name: "auth-service",
    triggered_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    resolved_at: null,
    slack_thread_ts: null,
    created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    trace_id: "a3c2b1d4e5f6789012345678abcdef01",
    rca: null,
  },
  {
    id: "inc-003",
    source: "grafana",
    external_id: "GF-881",
    title: "notification-service queue depth > 50,000 (DLQ backup)",
    severity: "high",
    status: "investigated",
    service_name: "notification-service",
    triggered_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    slack_thread_ts: "1744265100.654321",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    trace_id: "7f1e3d2c4b5a6978091234567890abcd",
    rca: {
      id: "rca-003",
      incident_id: "inc-003",
      root_cause:
        "A malformed email template introduced in v1.8.0 caused the notification worker to throw on every message, backing up the SQS queue without consuming it.",
      summary: `## Root Cause Analysis — notification-service Queue Backup

**Root Cause:** v1.8.0 introduced a Handlebars template with an unclosed \`{{#if}}\` block. The worker crashes on render, NACK-ing every message back to SQS, creating an infinite retry loop.

### Evidence
- **Logs:** \`HandlebarsException: Parse error at position 142: Unexpected token '#'\` — 12,000 occurrences in 2h
- **Metrics:** Queue depth grew linearly from 0 → 52,000 over 90 minutes (no consumption)
- **Deploy:** v1.8.0 commit \`e9a1d3f\` — "feat: add promotional email template"

### Fix Applied
Reverted the broken template. Queue drained in ~18 minutes after fix.`,
      confidence: "high",
      timeline: [
        { ts: "2026-04-10T07:00:00Z", event: "v1.8.0 deployed with broken Handlebars template" },
        { ts: "2026-04-10T07:02:00Z", event: "Worker begins crashing on every message" },
        { ts: "2026-04-10T08:30:00Z", event: "Queue depth exceeds 50,000 — Grafana alert fires" },
        { ts: "2026-04-10T09:00:00Z", event: "sre.ai identifies template bug, PR opened" },
        { ts: "2026-04-10T09:15:00Z", event: "Hotfix deployed, queue begins draining" },
      ],
      recommended_actions: [
        { priority: "immediate", action: "Revert notification-service to v1.7.9", rationale: "Restores working template immediately" },
        { priority: "short_term", action: "Add Handlebars template validation to CI pipeline", rationale: "Catch parse errors before deploy" },
        { priority: "long_term", action: "Implement canary deploys for notification-service with queue depth as a rollback signal", rationale: "" },
      ],
      needs_pr: false,
      github_pr_url: "https://github.com/example/notification-service/pull/88",
      model_used: "claude-sonnet-4-6",
      generated_at: new Date(Date.now() - 1000 * 60 * 60 * 2 - 1000 * 60 * 45).toISOString(),
      code_context: {
        file_path: "notification-service/src/worker/consumer.py",
        class_name: "QueueConsumer",
        function_name: "process_batch",
        line_number: 112,
        snippet: `BATCH_SIZE = 10\nMAX_RETRIES = 3\n\nasync def process_batch(self):\n    msgs = await self.queue.receive(count=BATCH_SIZE)\n    for msg in msgs:\n        # BUG: template rendered here — crashes on malformed {{#if}} block\n        # Exception causes NACK → infinite retry loop\n        await self._send_notification(msg)  # no timeout — hangs if SMTP slow`,
        suggested_fix: `BATCH_SIZE = 100  # 10x throughput\nMAX_RETRIES = 3\nSEND_TIMEOUT = 5.0  # seconds\n\nasync def process_batch(self):\n    msgs = await self.queue.receive(count=BATCH_SIZE)\n    tasks = [\n        asyncio.wait_for(self._send_notification(msg), timeout=SEND_TIMEOUT)\n        for msg in msgs\n    ]\n    results = await asyncio.gather(*tasks, return_exceptions=True)\n    for msg, result in zip(msgs, results):\n        if isinstance(result, Exception):\n            logger.error("Failed to send notification: %s", result)\n            await self.queue.nack(msg, delay=backoff(msg.retry_count))`,
        change_description: "Increase batch size 10→100, add per-message send timeout (5s) to prevent slow SMTP blocking the worker, and replace silent crash with structured error logging + exponential-backoff NACK.",
      },
    },
  },
  {
    id: "inc-004",
    source: "pagerduty",
    external_id: "PD-3798",
    title: "api-gateway 502 rate spike — upstream connection refused",
    severity: "critical",
    status: "resolved",
    service_name: "api-gateway",
    triggered_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    slack_thread_ts: "1744190000.111222",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    trace_id: "b2c3d4e5f6a1789056789012345678ab",
    rca: {
      id: "rca-004",
      incident_id: "inc-004",
      root_cause:
        "A Kubernetes node OOM-killed the user-service pod, and the readiness probe timeout (2s) was too short to detect the restart, causing api-gateway to route to the terminated pod for ~90 seconds.",
      summary: `## Root Cause Analysis — api-gateway 502 Spike

**Root Cause:** OOM kill of user-service pod + too-short readiness probe timeout (2s) caused the api-gateway to route requests to a terminated pod for 90 seconds.

### Evidence
- **Metrics:** 502 rate jumped to 38% for exactly 92 seconds
- **Logs:** \`upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection failure\`
- **K8s events:** \`OOMKilled: user-service-7d4b9f8c6-xk2pq\` at exact time of 502 spike
- **Config:** \`readinessProbe.timeoutSeconds: 2\` — insufficient for cold-start JVM

### Fix Applied
Increased readiness probe timeout to 10s. Added memory limit increase from 512Mi → 1Gi.`,
      confidence: "high",
      timeline: [
        { ts: "2026-04-09T08:14:00Z", event: "user-service pod OOMKilled (512Mi limit hit)" },
        { ts: "2026-04-09T08:14:05Z", event: "api-gateway begins routing to terminated pod" },
        { ts: "2026-04-09T08:14:08Z", event: "502 rate spikes to 38%" },
        { ts: "2026-04-09T08:15:38Z", event: "Readiness probe detects unhealthy (after 92s)" },
        { ts: "2026-04-09T08:15:40Z", event: "Traffic rerouted, 502s resolve" },
      ],
      recommended_actions: [
        { priority: "immediate", action: "Increase user-service memory limit from 512Mi → 1Gi", rationale: "Prevents OOM recurrence" },
        { priority: "short_term", action: "Set readinessProbe.timeoutSeconds: 10 for JVM services", rationale: "Gives time for JVM warm-up" },
        { priority: "long_term", action: "Implement pod disruption budgets and multi-AZ pod scheduling for all critical services", rationale: "" },
      ],
      needs_pr: false,
      github_pr_url: null,
      model_used: "claude-sonnet-4-6",
      generated_at: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
      code_context: {
        file_path: "user-service/k8s/deployment.yaml",
        function_name: "readinessProbe",
        line_number: 38,
        snippet: `resources:\n  limits:\n    memory: "512Mi"   # BUG: too low for JVM warm-up\n    cpu: "500m"\nreadinessProbe:\n  httpGet:\n    path: /health\n    port: 8080\n  initialDelaySeconds: 5\n  periodSeconds: 5\n  timeoutSeconds: 2    # BUG: 2s too short — JVM cold-start takes ~8s\n  failureThreshold: 3`,
        suggested_fix: `resources:\n  limits:\n    memory: "1Gi"      # doubled — prevents OOMKill under load\n    cpu: "500m"\n  requests:\n    memory: "512Mi"\nreadinessProbe:\n  httpGet:\n    path: /health\n    port: 8080\n  initialDelaySeconds: 15   # allow JVM to fully initialize\n  periodSeconds: 5\n  timeoutSeconds: 10   # JVM cold-start headroom\n  failureThreshold: 3`,
        change_description: "Raise memory limit 512Mi→1Gi to prevent OOMKill, and increase readinessProbe timeoutSeconds 2→10 to give the JVM enough cold-start time before traffic is routed.",
      },
    },
  },
  {
    id: "inc-005",
    source: "datadog",
    external_id: "DD-58990",
    title: "search-service Elasticsearch timeout — p99 > 8s",
    severity: "medium",
    status: "resolved",
    service_name: "search-service",
    triggered_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 60 * 47).toISOString(),
    slack_thread_ts: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    trace_id: "9e8d7c6b5a4312f0abcdef0123456789",
    rca: {
      id: "rca-005",
      incident_id: "inc-005",
      root_cause:
        "An unoptimized wildcard query introduced in the product search feature caused a full Elasticsearch index scan on every request, increasing p99 latency from 80ms to 8,200ms.",
      summary: `## Root Cause Analysis — search-service Elasticsearch Timeout

**Root Cause:** Wildcard prefix query \`*product_name*\` introduced in v3.1.0 triggered a full index scan (no inverted index usage), degrading p99 from 80ms → 8.2s.

### Fix
Replaced \`wildcard\` with \`match_phrase_prefix\` query. p99 immediately returned to 75ms.`,
      confidence: "high",
      timeline: [
        { ts: "2026-04-08T14:00:00Z", event: "v3.1.0 deployed with new wildcard search query" },
        { ts: "2026-04-08T14:05:00Z", event: "p99 latency begins climbing" },
        { ts: "2026-04-08T14:30:00Z", event: "Datadog alert fires (p99 > 8s)" },
        { ts: "2026-04-08T15:00:00Z", event: "Fix deployed, p99 returns to 75ms" },
      ],
      recommended_actions: [
        { priority: "immediate", action: "Replace wildcard query with match_phrase_prefix", rationale: "Uses inverted index, O(log n) instead of O(n)" },
        { priority: "short_term", action: "Add ES query explain logging to CI benchmark tests", rationale: "" },
        { priority: "long_term", action: "Set up Elasticsearch slow query log alerting", rationale: "" },
      ],
      needs_pr: true,
      github_pr_url: "https://github.com/example/search-service/pull/203",
      model_used: "claude-sonnet-4-6",
      generated_at: new Date(Date.now() - 1000 * 60 * 60 * 47 - 1000 * 60 * 30).toISOString(),
      code_context: {
        file_path: "search-service/src/search/query_builder.py",
        class_name: "ProductQueryBuilder",
        function_name: "build_search_query",
        line_number: 89,
        snippet: `def build_search_query(self, term: str) -> dict:\n    # BUG: wildcard query forces full index scan — O(n) on every request\n    return {\n        "query": {\n            "wildcard": {\n                "product_name": {\n                    "value": f"*{term}*",  # leading wildcard kills inverted index\n                    "boost": 1.0\n                }\n            }\n        }\n    }`,
        suggested_fix: `def build_search_query(self, term: str) -> dict:\n    # Use match_phrase_prefix — leverages inverted index, O(log n)\n    return {\n        "query": {\n            "bool": {\n                "should": [\n                    {\n                        "match_phrase_prefix": {\n                            "product_name": {\n                                "query": term,\n                                "max_expansions": 50,\n                                "boost": 2.0\n                            }\n                        }\n                    },\n                    {\n                        "match": {\n                            "product_name": {\n                                "query": term,\n                                "fuzziness": "AUTO"\n                            }\n                        }\n                    }\n                ]\n            }\n        }\n    }`,
        change_description: "Replace wildcard query (full index scan, O(n)) with match_phrase_prefix + fuzzy match combo to leverage Elasticsearch's inverted index and bring p99 back from 8.2s to ~75ms.",
      },
    },
  },
];

export const MOCK_TOPOLOGY = {
  nodes: [
    { id: "api-gateway", label: "api-gateway", incident_count: 3, severity: "critical", status: "healthy" as const },
    { id: "payment-service", label: "payment-service", incident_count: 5, severity: "critical", status: "warning" as const },
    { id: "auth-service", label: "auth-service", incident_count: 2, severity: "high", status: "warning" as const },
    { id: "user-service", label: "user-service", incident_count: 4, severity: "critical", status: "healthy" as const },
    { id: "notification-service", label: "notification-service", incident_count: 1, severity: "high", status: "healthy" as const },
    { id: "search-service", label: "search-service", incident_count: 2, severity: "medium", status: "healthy" as const },
    { id: "order-service", label: "order-service", incident_count: 0, severity: "low", status: "healthy" as const },
    { id: "inventory-service", label: "inventory-service", incident_count: 1, severity: "medium", status: "healthy" as const },
    { id: "analytics-service", label: "analytics-service", incident_count: 0, severity: "low", status: "healthy" as const },
  ],
  edges: [
    { source: "api-gateway", target: "auth-service" },
    { source: "api-gateway", target: "payment-service" },
    { source: "api-gateway", target: "user-service" },
    { source: "api-gateway", target: "search-service" },
    { source: "api-gateway", target: "order-service" },
    { source: "order-service", target: "payment-service" },
    { source: "order-service", target: "notification-service" },
    { source: "order-service", target: "inventory-service" },
    { source: "payment-service", target: "notification-service" },
    { source: "user-service", target: "analytics-service" },
  ],
};
