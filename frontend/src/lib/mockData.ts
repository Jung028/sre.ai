import type { Incident } from "./types";

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
      model_used: "claude-sonnet-4-6",
      generated_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
    },
  },
  {
    id: "inc-002",
    source: "datadog",
    external_id: "DD-59201",
    title: "auth-service p99 latency > 4000ms (SLO breach)",
    severity: "high",
    status: "investigating",
    service_name: "auth-service",
    triggered_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    resolved_at: null,
    slack_thread_ts: null,
    created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
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
