"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Copy, GitFork, Loader2 } from "lucide-react";
import Link from "next/link";
import { TraceMap } from "@/components/trace/TraceMap";
import { SpanLogPanel } from "@/components/trace/SpanLogPanel";
import { TraceWaterfall } from "@/components/trace/TraceWaterfall";
import type { TraceData } from "@/lib/types";

const STATUS_DOT: Record<string, string> = {
  ok: "bg-green-400",
  error: "bg-red-500",
  slow: "bg-yellow-400",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button
      onClick={copy}
      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
      title="Copy trace ID"
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

export default function TracePage() {
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"map" | "waterfall">("map");

  useEffect(() => {
    fetch(`/api/traces/${traceId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        return res.json();
      })
      .then((data) => { setTrace(data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load trace"))
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading trace…
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p className="text-sm text-red-400">{error ?? "Trace not found."}</p>
        <Link href="/incidents" className="text-indigo-400 text-sm mt-3 inline-block hover:underline">
          ← Back to incidents
        </Link>
      </div>
    );
  }

  const overallStatus = trace.nodes.some((n) => n.status === "error")
    ? "error"
    : trace.nodes.some((n) => n.status === "slow")
    ? "slow"
    : "ok";

  const errorNode = trace.nodes.find((n) => n.status === "error");

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/incidents" className="text-slate-500 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <GitFork className="text-indigo-400" size={18} />
        <h1 className="text-base font-semibold text-white">Distributed Trace</h1>
        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[overallStatus]}`} />
        <span className="text-xs text-slate-500 capitalize">{overallStatus}</span>
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {
            label: "Trace ID",
            value: (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-slate-400 truncate">{traceId}</span>
                <CopyButton text={traceId} />
              </div>
            ),
          },
          { label: "Root Service", value: <code className="text-indigo-300 text-xs">{trace.service}</code> },
          {
            label: "Duration",
            value: (
              <span className={`font-mono text-xs ${overallStatus === "error" ? "text-red-400" : overallStatus === "slow" ? "text-yellow-400" : "text-green-400"}`}>
                {trace.durationMs >= 1000 ? `${(trace.durationMs / 1000).toFixed(2)}s` : `${trace.durationMs}ms`}
              </span>
            ),
          },
          {
            label: "Incident",
            value: (
              <Link href={`/incidents/${trace.incidentId}`} className="text-indigo-400 hover:underline text-xs">
                {trace.incidentId} →
              </Link>
            ),
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[var(--bg-surface)] border border-slate-800 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-500 mb-0.5">{label}</p>
            <div className="text-sm text-slate-200">{value}</div>
          </div>
        ))}
      </div>

      {/* Error callout */}
      {errorNode && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          <p className="text-sm text-red-300">
            Incident detected at <strong className="text-red-200">{errorNode.label}</strong> — click the node to view error logs
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["map", "waterfall"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
              tab === t ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {t === "map" ? "Trace Map" : "Waterfall"}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className={`flex gap-4 ${selectedNodeId ? "" : ""}`}>
        {/* Left: map or waterfall */}
        <div className={`flex-1 min-w-0 bg-[var(--bg-deep)] border border-slate-800 rounded-xl p-4 transition-all`}>
          {tab === "map" ? (
            <TraceMap
              trace={trace}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          ) : (
            <TraceWaterfall
              trace={trace}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          )}
        </div>

        {/* Right: log panel (visible when node selected) */}
        {selectedNodeId && (
          <div className="w-80 flex-shrink-0 bg-[var(--bg-surface)] border border-slate-800 rounded-xl p-4 max-h-[70vh] overflow-hidden flex flex-col">
            <SpanLogPanel
              trace={trace}
              selectedNodeId={selectedNodeId}
              onClose={() => setSelectedNodeId(null)}
            />
          </div>
        )}
      </div>

      {/* Service stats footer */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {trace.nodes.map((node) => {
          const nodeSpans = trace.spans.filter((s) => s.service === node.id);
          const totalDuration = nodeSpans.reduce((sum, s) => sum + s.durationMs, 0);
          const style = {
            error: "border-red-500/30 bg-red-500/5",
            slow: "border-yellow-500/30 bg-yellow-500/5",
            ok: "border-slate-800 bg-slate-800/20",
          }[node.status];

          return (
            <button
              key={node.id}
              onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
              className={`text-left border rounded-lg p-3 transition-all hover:scale-[1.01] ${style} ${
                selectedNodeId === node.id ? "ring-1 ring-indigo-400" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-200">{node.label}</span>
                <span className={`text-[10px] font-bold uppercase ${
                  node.status === "error" ? "text-red-400" : node.status === "slow" ? "text-yellow-400" : "text-green-400"
                }`}>{node.status}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {nodeSpans.length} span{nodeSpans.length !== 1 ? "s" : ""} · {totalDuration}ms total
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
