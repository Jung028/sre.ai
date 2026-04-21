"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy, GitFork } from "lucide-react";
import { SeverityBadge } from "./SeverityBadge";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

function TraceIdBadge({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(traceId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const short = traceId.slice(0, 8) + "…" + traceId.slice(-4);

  return (
    <div className="flex items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
      <Link
        href={`/traces/${traceId}`}
        className="flex items-center gap-1 text-[10px] font-mono text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 px-1.5 py-0.5 rounded transition-colors"
        title={traceId}
      >
        <GitFork size={10} />
        {short}
      </Link>
      <button
        onClick={handleCopy}
        className="p-0.5 rounded text-slate-600 hover:text-slate-300 transition-colors"
        title="Copy trace ID"
      >
        {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
      </button>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  investigating: "text-yellow-400",
  investigated: "text-blue-400",
  needs_pr: "text-purple-400",
  resolved: "text-green-400",
};

export function IncidentCard({ incident }: { incident: Incident }) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/incidents/${incident.id}`)}
      className="block bg-[var(--bg-surface)] border border-slate-800/80 rounded-xl p-4 hover:border-indigo-500/30 hover:bg-slate-800/40 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge severity={incident.severity} />
            <span className="text-xs text-slate-500">{incident.source}</span>
          </div>
          <h3 className="text-sm font-medium text-slate-100 group-hover:text-white truncate transition-colors">{incident.title}</h3>
          {incident.service_name && (
            <p className="text-xs text-slate-500 mt-0.5">
              Service: <code className="text-indigo-400/80 font-mono">{incident.service_name}</code>
            </p>
          )}
          {incident.trace_id && <TraceIdBadge traceId={incident.trace_id} />}
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-xs font-medium ${STATUS_COLORS[incident.status] ?? "text-slate-400"}`}>
            {incident.status.replace("_", " ")}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            {formatDistanceToNow(incident.triggered_at)}
          </p>
        </div>
      </div>
    </div>
  );
}
