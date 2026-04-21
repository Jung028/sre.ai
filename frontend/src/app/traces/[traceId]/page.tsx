"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Copy, GitFork, Loader2 } from "lucide-react";
import Link from "next/link";
import { TraceMap } from "@/components/trace/TraceMap";
import { SpanLogPanel } from "@/components/trace/SpanLogPanel";
import type { TraceData } from "@/lib/types";

const STATUS_DOT: Record<string, string> = {
  ok:    "bg-green-400",
  error: "bg-red-500",
  slow:  "bg-yellow-400",
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
  const [trace,          setTrace]          = useState<TraceData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading trace…
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="text-center py-24 text-slate-500">
        <GitFork size={36} className="mx-auto mb-3 opacity-20" />
        <p className="text-sm text-red-400 mb-3">{error ?? "Trace not found."}</p>
        <Link href="/traces" className="text-indigo-400 text-sm hover:underline">
          ← Back to trace search
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
    /* Full-height layout — escape parent padding to fill viewport */
    <div className="flex flex-col -mx-6 -mt-6 lg:-mx-8 lg:-mt-8" style={{ height: "calc(100vh - 0px)", maxHeight: "100vh" }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-6 lg:px-8 py-3.5 border-b border-slate-800/80 flex-shrink-0 bg-[var(--bg-sidebar)]">
        <Link href="/traces" className="text-slate-500 hover:text-white transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <GitFork className="text-indigo-400" size={16} />
        <span className="text-sm font-semibold text-white">Distributed Trace</span>
        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[overallStatus]}`} />
        <span className="text-xs text-slate-500 capitalize">{overallStatus}</span>

        {/* Meta pills */}
        <div className="ml-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Root:</span>
          <code className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
            {trace.service}
          </code>
          <span className="text-xs text-slate-600">·</span>
          <span className={`text-xs font-mono font-semibold ${
            overallStatus === "error" ? "text-red-400" : overallStatus === "slow" ? "text-yellow-400" : "text-green-400"
          }`}>
            {trace.durationMs >= 1000 ? `${(trace.durationMs / 1000).toFixed(2)}s` : `${trace.durationMs}ms`}
          </span>
          <span className="text-xs text-slate-600">·</span>
          <span className="font-mono text-[11px] text-slate-500">{traceId.slice(0, 16)}…</span>
          <CopyButton text={traceId} />
          {trace.incidentId && (
            <>
              <span className="text-xs text-slate-600">·</span>
              <Link
                href={`/incidents/${trace.incidentId}`}
                className="text-xs text-indigo-400 hover:underline"
              >
                {trace.incidentId} →
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Error callout ── */}
      {errorNode && (
        <div className="mx-6 lg:mx-8 mt-3 px-4 py-2.5 bg-red-900/20 border border-red-800/40 rounded-lg flex items-center gap-2 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          <p className="text-sm text-red-300">
            Incident detected at <strong className="text-red-200">{errorNode.label}</strong>
            <span className="text-red-400/70"> — click the node to view logs</span>
          </p>
        </div>
      )}

      {/* ── Main area: map + log panel ── */}
      <div className="flex flex-1 overflow-hidden mt-3 px-6 lg:px-8 pb-3 gap-3">

        {/* Map — fills remaining space */}
        <div className="flex-1 min-w-0 bg-[var(--bg-deep)] border border-slate-800 rounded-xl overflow-auto relative">
          {/* Hint overlay (disappears once something selected) */}
          {!selectedNodeId && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <p className="text-[11px] text-slate-600 bg-[var(--bg-surface)] border border-slate-800 rounded-full px-3 py-1 whitespace-nowrap">
                Click a node for logs · Click an arrow for connection details
              </p>
            </div>
          )}
          <div className="p-5">
            <TraceMap
              trace={trace}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </div>
        </div>

        {/* Log panel — slides in when node selected */}
        {selectedNodeId && (
          <div className="w-96 flex-shrink-0 bg-[var(--bg-surface)] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
            <div className="p-4 flex-1 overflow-hidden flex flex-col">
              <SpanLogPanel
                trace={trace}
                selectedNodeId={selectedNodeId}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Service stats bar ── */}
      <div className="px-6 lg:px-8 pb-4 flex-shrink-0">
        <div className="grid grid-cols-5 gap-2">
          {trace.nodes.map((node) => {
            const nodeSpans    = trace.spans.filter((s) => s.service === node.id);
            const totalDur     = nodeSpans.reduce((sum, s) => sum + s.durationMs, 0);
            const isSelected   = selectedNodeId === node.id;
            const statusBorder = {
              error: "border-red-500/30 bg-red-500/5",
              slow:  "border-yellow-500/30 bg-yellow-500/5",
              ok:    "border-slate-800 bg-slate-800/20",
            }[node.status];

            return (
              <button
                key={node.id}
                onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                className={`text-left border rounded-lg p-2.5 transition-all hover:scale-[1.01] ${statusBorder} ${
                  isSelected ? "ring-1 ring-indigo-400" : ""
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium text-slate-200 truncate pr-1">{node.label}</span>
                  <span className={`text-[10px] font-bold uppercase flex-shrink-0 ${
                    node.status === "error" ? "text-red-400" : node.status === "slow" ? "text-yellow-400" : "text-green-400"
                  }`}>{node.status}</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {nodeSpans.length} span{nodeSpans.length !== 1 ? "s" : ""} · {totalDur}ms
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
