export interface Incident {
  id: string;
  source: string;
  external_id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "investigating" | "investigated" | "needs_pr" | "resolved";
  service_name: string | null;
  triggered_at: string;
  resolved_at: string | null;
  slack_thread_ts: string | null;
  created_at: string;
  trace_id?: string | null;
  rca?: RCA | null;
}

export interface CodeContext {
  file_path: string;
  class_name?: string;
  function_name?: string;
  line_number?: number;
  snippet: string;
  suggested_fix: string;
  change_description: string;
}

export interface Evidence {
  type: "metric" | "log" | "deploy" | "code" | "trace";
  label: string;
  value: string;
  detail?: string;
  delta?: string; // e.g. "0.1% → 23%"
}

export interface RCA {
  id: string;
  incident_id: string;
  root_cause: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  timeline: TimelineEntry[];
  recommended_actions: Action[];
  needs_pr: boolean;
  pr_description?: string | null;
  github_pr_url: string | null;
  model_used: string;
  generated_at: string;
  code_context?: CodeContext | null;
  evidence?: Evidence[];
}

export interface TimelineEntry {
  ts: string;
  event: string;
}

export interface Action {
  priority: "immediate" | "short_term" | "long_term";
  action: string;
  rationale?: string;
}

export interface StreamEvent {
  type: "thought" | "tool_start" | "tool_end" | "result" | "error";
  data: Record<string, unknown>;
  incident_id: string;
  timestamp: string;
}

export interface TopologyNode {
  id: string;
  label: string;
  incident_count: number;
  severity: string;
  status: "healthy" | "warning" | "critical";
}

export interface TopologyEdge {
  source: string;
  target: string;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  service: string;
  operation: string;
  startMs: number; // offset from trace start in ms
  durationMs: number;
  status: "ok" | "error" | "slow";
  logs: TraceLog[];
  tags?: Record<string, string>;
}

export interface TraceLog {
  offsetMs: number; // offset from span start
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

export interface TraceNode {
  id: string;
  label: string;
  type: "service" | "database" | "cache" | "queue" | "external";
  status: "ok" | "error" | "slow";
  depth: number;
  indexInDepth: number;
}

export interface TraceEdge {
  source: string;
  target: string;
  label?: string;
  status: "ok" | "error" | "slow";
}

export interface TraceData {
  traceId: string;
  incidentId: string;
  service: string;
  startTime: string; // ISO
  durationMs: number;
  spans: TraceSpan[];
  nodes: TraceNode[];
  edges: TraceEdge[];
}
