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
  rca?: RCA | null;
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
  github_pr_url: string | null;
  model_used: string;
  generated_at: string;
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
