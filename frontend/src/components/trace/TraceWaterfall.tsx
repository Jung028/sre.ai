"use client";

import type { TraceData, TraceSpan } from "@/lib/types";

const SERVICE_COLORS = [
  "bg-indigo-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-teal-500",
  "bg-emerald-500",
];

const STATUS_OVERLAY: Record<string, string> = {
  error: "border-2 border-red-400",
  slow: "border-2 border-yellow-400",
  ok: "",
};

function formatMs(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

interface Props {
  trace: TraceData;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

export function TraceWaterfall({ trace, selectedNodeId, onSelectNode }: Props) {
  const totalMs = trace.durationMs;
  const services = [...new Set(trace.spans.map((s) => s.service))];
  const colorMap: Record<string, string> = {};
  services.forEach((s, i) => { colorMap[s] = SERVICE_COLORS[i % SERVICE_COLORS.length]; });

  const sortedSpans = [...trace.spans].sort((a, b) => a.startMs - b.startMs);

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {services.map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`w-2.5 h-2.5 rounded-sm ${colorMap[s]}`} />
            {s}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 ml-auto">
          <span className="w-2.5 h-2.5 rounded-sm border-2 border-red-400 bg-transparent" />error
          <span className="w-2.5 h-2.5 rounded-sm border-2 border-yellow-400 bg-transparent ml-2" />slow
        </div>
      </div>

      {/* Timeline header */}
      <div className="flex mb-1 pl-44">
        {[0, 25, 50, 75, 100].map((pct) => (
          <div key={pct} className="flex-1 text-[10px] text-slate-600 font-mono text-right pr-1">
            {formatMs(Math.round((totalMs * pct) / 100))}
          </div>
        ))}
      </div>

      {/* Spans */}
      <div className="space-y-1">
        {sortedSpans.map((span) => {
          const leftPct = (span.startMs / totalMs) * 100;
          const widthPct = Math.max((span.durationMs / totalMs) * 100, 0.5);
          const isHighlighted = selectedNodeId === span.service;
          const isDimmed = selectedNodeId !== null && !isHighlighted;

          return (
            <button
              key={span.spanId}
              onClick={() => onSelectNode(isHighlighted ? null : span.service)}
              className={`w-full flex items-center gap-2 group transition-opacity ${isDimmed ? "opacity-30" : "opacity-100"}`}
            >
              {/* Label */}
              <div className="w-44 flex-shrink-0 text-right pr-3">
                <p className="text-[11px] text-slate-400 truncate font-mono">{span.service}</p>
                <p className="text-[10px] text-slate-600 truncate">{span.operation}</p>
              </div>

              {/* Bar track */}
              <div className="flex-1 relative h-6 bg-slate-900 rounded overflow-hidden">
                {/* Grid lines */}
                {[25, 50, 75].map((p) => (
                  <div
                    key={p}
                    className="absolute top-0 bottom-0 border-l border-slate-800/60"
                    style={{ left: `${p}%` }}
                  />
                ))}
                {/* Span bar */}
                <div
                  className={`absolute top-1 bottom-1 rounded ${colorMap[span.service]} ${STATUS_OVERLAY[span.status]} opacity-80 group-hover:opacity-100 transition-opacity`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              </div>

              {/* Duration */}
              <div className="w-14 flex-shrink-0 text-[10px] text-slate-500 font-mono text-right">
                {formatMs(span.durationMs)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Total */}
      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-500 border-t border-slate-800 pt-2">
        <span>{sortedSpans.length} spans</span>
        <span>·</span>
        <span>Total: <span className="text-slate-300 font-mono">{formatMs(totalMs)}</span></span>
      </div>
    </div>
  );
}
