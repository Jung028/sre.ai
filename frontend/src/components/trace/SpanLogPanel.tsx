"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { TraceData, TraceSpan } from "@/lib/types";

const STATUS_COLORS = {
  ok:    "text-green-400 border-green-500/30 bg-green-500/5",
  error: "text-red-400 border-red-500/40 bg-red-500/10",
  slow:  "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info:  "text-slate-400",
  debug: "text-slate-600",
  warn:  "text-yellow-400",
  error: "text-red-400",
};

const LOG_LEVEL_BG: Record<string, string> = {
  info:  "bg-slate-700/40 text-slate-300",
  debug: "bg-slate-800/60 text-slate-500",
  warn:  "bg-yellow-500/15 text-yellow-300",
  error: "bg-red-500/15 text-red-300",
};

type LogLevel = "info" | "debug" | "warn" | "error";
const ALL_LEVELS: LogLevel[] = ["info", "debug", "warn", "error"];

function SpanRow({ span, logSearch, logLevels, fromMs, toMs }: {
  span: TraceSpan;
  logSearch: string;
  logLevels: Set<LogLevel>;
  fromMs: string;
  toMs: string;
}) {
  const [open, setOpen] = useState(span.status !== "ok");

  const filteredLogs = useMemo(() => {
    const from = fromMs !== "" ? Number(fromMs) : -Infinity;
    const to   = toMs   !== "" ? Number(toMs)   : Infinity;
    const q = logSearch.trim().toLowerCase();
    return span.logs.filter((log) => {
      if (!logLevels.has(log.level as LogLevel)) return false;
      if (log.offsetMs < from || log.offsetMs > to) return false;
      if (q && !log.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [span.logs, logSearch, logLevels, fromMs, toMs]);

  if (filteredLogs.length === 0 && (logSearch || fromMs || toMs || logLevels.size < 4)) return null;

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-left"
      >
        {open
          ? <ChevronDown  size={12} className="text-slate-500 flex-shrink-0" />
          : <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />}
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
          {filteredLogs.length === 0 ? (
            <p className="text-[11px] text-slate-600 italic py-1">No logs match filters.</p>
          ) : (
            filteredLogs.map((log, i) => (
              <div key={i} className={`flex gap-2 text-[11px] rounded px-1 py-0.5 ${LOG_LEVEL_BG[log.level] ?? ""}`}>
                <span className="font-mono text-slate-600 flex-shrink-0 w-14 text-right">+{log.offsetMs}ms</span>
                <span className={`font-bold flex-shrink-0 uppercase text-[9px] w-8 mt-px ${LOG_LEVEL_COLORS[log.level]}`}>
                  {log.level}
                </span>
                <span className="text-slate-300 font-mono break-all">{log.message}</span>
              </div>
            ))
          )}
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
  const [methodSearch, setMethodSearch] = useState("");
  const [logSearch,    setLogSearch]    = useState("");
  const [fromMs,       setFromMs]       = useState("");
  const [toMs,         setToMs]         = useState("");
  const [logLevels,    setLogLevels]    = useState<Set<LogLevel>>(new Set(ALL_LEVELS));

  const node      = trace.nodes.find((n) => n.id === selectedNodeId);
  const nodeSpans = trace.spans.filter((s) => s.service === selectedNodeId);

  const filteredSpans = useMemo(() => {
    const q = methodSearch.trim().toLowerCase();
    if (!q) return nodeSpans;
    return nodeSpans.filter((s) => s.operation.toLowerCase().includes(q));
  }, [nodeSpans, methodSearch]);

  function toggleLevel(lvl: LogLevel) {
    setLogLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) {
        if (next.size > 1) next.delete(lvl); // keep at least one
      } else {
        next.add(lvl);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-white">{node?.label ?? selectedNodeId}</h3>
          <p className="text-xs text-slate-500 capitalize">
            {node?.type} · {nodeSpans.length} span{nodeSpans.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="space-y-2 mb-3 flex-shrink-0">
        {/* Method / operation search */}
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={methodSearch}
            onChange={(e) => setMethodSearch(e.target.value)}
            placeholder="Filter by method / operation…"
            className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-7 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
          {methodSearch && (
            <button onClick={() => setMethodSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Log message search */}
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder="Search log messages…"
            className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-7 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
          {logSearch && (
            <button onClick={() => setLogSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Time offset range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 flex-shrink-0">ms offset</span>
          <input
            type="number"
            value={fromMs}
            onChange={(e) => setFromMs(e.target.value)}
            placeholder="from"
            min={0}
            className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 w-0"
          />
          <span className="text-slate-600 text-xs flex-shrink-0">→</span>
          <input
            type="number"
            value={toMs}
            onChange={(e) => setToMs(e.target.value)}
            placeholder="to"
            min={0}
            className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 w-0"
          />
        </div>

        {/* Log level toggle pills */}
        <div className="flex gap-1 flex-wrap">
          {ALL_LEVELS.map((lvl) => {
            const active = logLevels.has(lvl);
            const cls = {
              info:  active ? "bg-slate-700 text-slate-200" : "bg-transparent text-slate-600 border-slate-800",
              debug: active ? "bg-slate-800 text-slate-400" : "bg-transparent text-slate-700 border-slate-800",
              warn:  active ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-transparent text-slate-600 border-slate-800",
              error: active ? "bg-red-500/20 text-red-300 border-red-500/30"          : "bg-transparent text-slate-600 border-slate-800",
            }[lvl];
            return (
              <button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border transition-colors ${cls}`}
              >
                {lvl}
              </button>
            );
          })}
          <button
            onClick={() => { setMethodSearch(""); setLogSearch(""); setFromMs(""); setToMs(""); setLogLevels(new Set(ALL_LEVELS)); }}
            className="ml-auto text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Span list ── */}
      {nodeSpans.length === 0 ? (
        <p className="text-xs text-slate-600 italic">No spans for this node.</p>
      ) : filteredSpans.length === 0 ? (
        <p className="text-xs text-slate-600 italic">No spans match &quot;{methodSearch}&quot;.</p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1 pr-0.5">
          {filteredSpans.map((span) => (
            <SpanRow
              key={span.spanId}
              span={span}
              logSearch={logSearch}
              logLevels={logLevels}
              fromMs={fromMs}
              toMs={toMs}
            />
          ))}
        </div>
      )}
    </div>
  );
}
