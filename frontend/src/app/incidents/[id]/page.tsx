"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Clock, ExternalLink, Loader2, Terminal } from "lucide-react";
import Link from "next/link";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";
import { RcaPanel } from "@/components/investigation/RcaPanel";
import { StreamingBubble } from "@/components/investigation/StreamingBubble";
import { useIncidentStream } from "@/lib/useIncidentStream";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  investigating: { label: "Investigating", color: "text-yellow-400" },
  investigated: { label: "Investigated", color: "text-blue-400" },
  needs_pr: { label: "Fix Ready", color: "text-purple-400" },
  resolved: { label: "Resolved", color: "text-green-400" },
};

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLive = incident?.status === "investigating";
  const { events, rca: streamedRca, status: streamStatus } = useIncidentStream(isLive ? id : null);

  useEffect(() => {
    api.incidents
      .get(id)
      .then((data) => {
        setIncident(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading incident...
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p className="text-sm text-red-400">{error ?? "Incident not found."}</p>
        <Link href="/incidents" className="text-indigo-400 text-sm mt-3 inline-block hover:underline">
          ← Back to incidents
        </Link>
      </div>
    );
  }

  const statusInfo = STATUS_LABEL[incident.status] ?? { label: incident.status, color: "text-slate-400" };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/incidents" className="text-slate-500 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <SeverityBadge severity={incident.severity} />
        <h1 className="text-base font-semibold text-white truncate flex-1">{incident.title}</h1>
        <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Service", value: <code className="text-indigo-300">{incident.service_name ?? "unknown"}</code> },
          { label: "Source", value: incident.source },
          { label: "Triggered", value: formatDistanceToNow(incident.triggered_at) },
          {
            label: "ID",
            value: <span className="text-slate-500 font-mono text-xs">{incident.external_id}</span>,
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#17171f] border border-slate-800 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-500 mb-0.5">{label}</p>
            <p className="text-sm text-slate-200">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: live stream OR timeline */}
        <div>
          {isLive ? (
            <>
              <h2 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                <Terminal size={14} className="text-yellow-400" />
                Live Investigation
                <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              </h2>
              <StreamingBubble events={events} status={streamStatus} />
            </>
          ) : incident.rca?.timeline && incident.rca.timeline.length > 0 ? (
            <>
              <h2 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                <Clock size={14} className="text-indigo-400" />
                Incident Timeline
              </h2>
              <div className="bg-[#0d0d14] border border-slate-800 rounded-xl p-4 space-y-3">
                {incident.rca.timeline.map((entry, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 mt-0.5 flex-shrink-0" />
                      {i < (incident.rca?.timeline.length ?? 0) - 1 && (
                        <div className="w-px flex-1 bg-slate-800 mt-1" />
                      )}
                    </div>
                    <div className="pb-3">
                      <p className="text-slate-500 font-mono mb-0.5">
                        {new Date(entry.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                      <p className="text-slate-300">{entry.event}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recommended actions */}
              {incident.rca?.recommended_actions && incident.rca.recommended_actions.length > 0 && (
                <div className="mt-4">
                  <h2 className="text-sm font-medium text-slate-300 mb-3">Recommended Actions</h2>
                  <div className="space-y-2">
                    {incident.rca.recommended_actions.map((action, i) => {
                      const colors: Record<string, string> = {
                        immediate: "border-red-500/30 bg-red-500/5 text-red-400",
                        short_term: "border-yellow-500/30 bg-yellow-500/5 text-yellow-400",
                        long_term: "border-blue-500/30 bg-blue-500/5 text-blue-400",
                      };
                      return (
                        <div key={i} className={`border rounded-lg p-3 ${colors[action.priority] ?? "border-slate-700 bg-slate-800/20 text-slate-400"}`}>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-1 opacity-70">{action.priority.replace("_", " ")}</p>
                          <p className="text-xs text-slate-200">{action.action}</p>
                          {action.rationale && <p className="text-xs opacity-60 mt-1">{action.rationale}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="text-sm font-medium text-slate-300 mb-3">Investigation Log</h2>
              <StreamingBubble events={[]} status="idle" />
            </>
          )}
        </div>

        {/* Right: RCA summary */}
        <div>
          <h2 className="text-sm font-medium text-slate-300 mb-3">Root Cause Analysis</h2>
          <div className="bg-[#17171f] border border-slate-800 rounded-xl p-4 min-h-[20rem]">
            <RcaPanel rca={incident.rca} streamedText={streamedRca} />
          </div>

          {incident.rca?.github_pr_url && (
            <a
              href={incident.rca.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors w-full justify-center"
            >
              <ExternalLink size={14} />
              View Fix PR on GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
