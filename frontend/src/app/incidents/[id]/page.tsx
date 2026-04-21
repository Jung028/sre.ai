"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  GitFork,
  Loader2,
  Terminal,
} from "lucide-react";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";
import { RcaDetailView } from "@/components/investigation/RcaDetailView";
import { RcaPanel } from "@/components/investigation/RcaPanel";
import { StreamingBubble } from "@/components/investigation/StreamingBubble";
import { useIncidentStream } from "@/lib/useIncidentStream";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

// ─── Status pill ──────────────────────────────────────────────────────────────
const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  investigating: { label: "Investigating",  dot: "bg-yellow-400 animate-pulse", text: "text-yellow-400" },
  investigated:  { label: "Investigated",   dot: "bg-blue-400",                 text: "text-blue-400"   },
  needs_pr:      { label: "Fix Ready",      dot: "bg-purple-400",               text: "text-purple-400" },
  resolved:      { label: "Resolved",       dot: "bg-green-400",                text: "text-green-400"  },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, dot: "bg-slate-400", text: "text-slate-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}
      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
    >
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const isLive = incident?.status === "investigating";
  const { events, rca: streamedRca, status: streamStatus } = useIncidentStream(isLive ? id : null);

  useEffect(() => {
    api.incidents.get(id)
      .then((data) => { setIncident(data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading incident…
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !incident) {
    return (
      <div className="text-center py-24 text-slate-500">
        <p className="text-sm text-red-400 mb-3">{error ?? "Incident not found."}</p>
        <Link href="/incidents" className="text-indigo-400 text-sm hover:underline">← Back to incidents</Link>
      </div>
    );
  }

  const hasRca = !!incident.rca;

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/incidents" className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
          <ArrowLeft size={18} />
        </Link>
        <SeverityBadge severity={incident.severity} />
        <h1 className="text-base font-semibold text-white leading-snug flex-1 min-w-0 truncate">
          {incident.title}
        </h1>
        <StatusPill status={incident.status} />
      </div>

      {/* ── Meta strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Service",   value: <code className="text-indigo-300 text-xs">{incident.service_name ?? "unknown"}</code> },
          { label: "Source",    value: <span className="capitalize">{incident.source}</span> },
          { label: "Triggered", value: formatDistanceToNow(incident.triggered_at) },
          { label: "ID",        value: <span className="font-mono text-slate-500 text-xs">{incident.external_id}</span> },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl px-4 py-2.5">
            <p className="text-xs text-slate-500 mb-0.5">{label}</p>
            <p className="text-sm text-slate-200">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Trace ID bar ────────────────────────────────────────────────── */}
      {incident.trace_id && (
        <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3">
          <GitFork size={14} className="text-indigo-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-0.5">Trace ID</p>
            <p className="font-mono text-xs text-slate-300 truncate">{incident.trace_id}</p>
          </div>
          <CopyButton text={incident.trace_id} />
          <Link
            href={`/traces/${incident.trace_id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 text-xs rounded-lg transition-colors"
          >
            <ExternalLink size={12} />
            View Trace
          </Link>
        </div>
      )}

      {/* ── Live investigation stream (when actively running) ────────────── */}
      {isLive && (
        <div>
          <h2 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
            <Terminal size={14} className="text-yellow-400" />
            Live Investigation
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          </h2>
          <StreamingBubble events={events} status={streamStatus} />

          {/* Streaming RCA as it arrives */}
          {streamedRca && (
            <div className="mt-4 bg-[var(--bg-surface)] border border-slate-800 rounded-xl p-4">
              <RcaPanel rca={null} streamedText={streamedRca} />
            </div>
          )}
        </div>
      )}

      {/* ── Full RCA detail (once investigation is done) ─────────────────── */}
      {!isLive && hasRca && (
        <RcaDetailView
          rca={incident.rca!}
          triggeredAt={incident.triggered_at}
          serviceName={incident.service_name}
        />
      )}

      {/* ── No RCA yet ───────────────────────────────────────────────────── */}
      {!isLive && !hasRca && (
        <div className="flex items-center gap-3 px-4 py-6 rounded-xl border border-slate-800 bg-slate-900/40">
          <Clock size={16} className="text-slate-600" />
          <p className="text-sm text-slate-500">Investigation hasn't run yet — trigger it via a webhook or the API.</p>
        </div>
      )}
    </div>
  );
}
