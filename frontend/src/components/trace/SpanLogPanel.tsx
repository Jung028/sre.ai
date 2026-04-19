"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { TraceData, TraceSpan } from "@/lib/types";

const STATUS_COLORS = {
  ok: "text-green-400 border-green-500/30 bg-green-500/5",
  error: "text-red-400 border-red-500/40 bg-red-500/8",
  slow: "text-yellow-400 border-yellow-500/40 bg-yellow-500/8",
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: "text-slate-400",
  debug: "text-slate-600",
  warn: "text-yellow-400",
  error: "text-red-400",
};

function SpanRow({ span }: { span: TraceSpan }) {
  const [open, setOpen] = useState(span.status !== "ok");

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-left"
      >
        {open ? <ChevronDown size={12} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />}
        <span className="text-xs font-mono text-slate-300 flex-1 truncate">{span.operation}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_COLORS[span.status]}`}>
          {span.status.toUpperCase()}
        </span>
        <span className="text-[10px] text-slate-500 ml-1 font-mono">{span.durationMs}ms</span>
      </button>

      {open && (
        <div className="px-3 py-2 space-y-1 bg-[var(--bg-deep)]">
          {span.tags && Object.keys(span.tags).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {Object.entries(span.tags).map(([k, v]) => (
                <span key={k} className="text-[9px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                  {k}={v}
                </span>
              ))}
            </div>
          )}
          {span.logs.map((log, i) => (
            <div key={i} className="flex gap-2 text-[11px]">
              <span className="font-mono text-slate-600 flex-shrink-0 w-14 text-right">+{log.offsetMs}ms</span>
              <span className={`font-bold flex-shrink-0 uppercase text-[9px] w-8 ${LOG_LEVEL_COLORS[log.level]}`}>
                {log.level}
              </span>
              <span className="text-slate-300 font-mono break-all">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  trace: TraceData;
  selectedNodeId: string;
  onClose: () => void;
}

export function SpanLogPanel({ trace, selectedNodeId, onClose }: Props) {
  const nodeSpans = trace.spans.filter((s) => s.service === selectedNodeId);
  const node = trace.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-white">{node?.label ?? selectedNodeId}</h3>
          <p className="text-xs text-slate-500 capitalize">{node?.type} · {nodeSpans.length} span{nodeSpans.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {nodeSpans.length === 0 ? (
        <p className="text-xs text-slate-600 italic">No spans for this node.</p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1 pr-1">
          {nodeSpans.map((span) => (
            <SpanRow key={span.spanId} span={span} />
          ))}
        </div>
      )}
    </div>
  );
}
