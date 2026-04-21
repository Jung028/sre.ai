"use client";

import { useEffect, useRef } from "react";
import { Brain, CheckCircle, Loader2, Terminal, XCircle } from "lucide-react";
import type { StreamEvent } from "@/lib/types";

interface Props {
  events: StreamEvent[];
  status: string;
}

export function StreamingBubble({ events, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="bg-[var(--bg-deep)] border border-slate-800 rounded-xl p-4 h-80 overflow-y-auto scrollbar-thin font-mono text-xs space-y-2">
      {events.length === 0 && (
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 size={12} className="animate-spin" />
          <span>Connecting to investigation stream...</span>
        </div>
      )}
      {events.map((ev, i) => (
        <EventLine key={i} event={ev} />
      ))}
      {status === "done" && (
        <div className="flex items-center gap-2 text-green-400 mt-2">
          <CheckCircle size={12} />
          <span>Investigation complete</span>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2 text-red-400 mt-2">
          <XCircle size={12} />
          <span>Investigation error</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

/**
 * Parse agent emoji + tool name from the combined "emoji tool_name" format
 * that specialist agents emit (e.g. "📊 fetch_metrics").
 * Returns { agentEmoji, agentLabel, toolName }.
 */
function parseAgentTool(name: string): { agentEmoji: string; agentLabel: string; toolName: string } {
  // Match a known agent emoji prefix (e.g. "📊 fetch_metrics" or "☸️ get_k8s_status")
  const emojiMatch = name.match(/^([^\x20-\x7E]+)\s+(.+)$/);
  if (emojiMatch) {
    const emoji = emojiMatch[1].trim();
    const rest = emojiMatch[2].trim();
    // Derive agent label from emoji
    const labelMap: Record<string, string> = {
      "📊": "MetricsAgent",
      "📋": "LogsAgent",
      "💻": "CodeAgent",
      "☸️": "KubernetesAgent",
      "🏗️": "InfraAgent",
      "🔬": "SpecialistAgent",
    };
    const agentLabel = labelMap[emoji] ?? "Agent";
    return { agentEmoji: emoji, agentLabel, toolName: rest };
  }
  return { agentEmoji: "", agentLabel: "", toolName: name };
}

function EventLine({ event }: { event: StreamEvent }) {
  switch (event.type) {
    case "thought":
      return (
        <div className="flex gap-2 text-slate-400">
          <Brain size={11} className="mt-0.5 flex-shrink-0 text-indigo-400" />
          <span className="whitespace-pre-wrap">{(event.data as { text: string }).text?.slice(0, 300)}</span>
        </div>
      );

    case "tool_start": {
      const d = event.data as { name: string; inputs?: Record<string, unknown> };
      const { agentEmoji, agentLabel, toolName } = parseAgentTool(d.name);
      const service = d.inputs?.service as string | undefined;

      return (
        <div className="flex gap-2 text-yellow-400">
          <Terminal size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            {agentEmoji && (
              <span className="mr-1">{agentEmoji}</span>
            )}
            {agentLabel && (
              <span className="text-yellow-300 font-semibold">{agentLabel}</span>
            )}
            {agentLabel && (
              <span className="text-slate-500 mx-1">·</span>
            )}
            <strong>{toolName}</strong>
            {service ? <span className="text-slate-400"> → {service}</span> : ""}
          </span>
        </div>
      );
    }

    case "tool_end": {
      const d = event.data as { name: string; success: boolean; summary?: string };
      const { agentEmoji, agentLabel, toolName } = parseAgentTool(d.name);

      return (
        <div className={`flex gap-2 ${d.success ? "text-green-400" : "text-red-400"}`}>
          {d.success
            ? <CheckCircle size={11} className="mt-0.5 flex-shrink-0" />
            : <XCircle size={11} className="mt-0.5 flex-shrink-0" />}
          <span>
            {agentEmoji && <span className="mr-1">{agentEmoji}</span>}
            {agentLabel && (
              <span className={`font-semibold ${d.success ? "text-green-300" : "text-red-300"}`}>
                {agentLabel}
              </span>
            )}
            {agentLabel && <span className="text-slate-500 mx-1">·</span>}
            {toolName} {d.success ? "✓" : "✗"}
            {d.summary ? <span className="text-slate-400"> — {d.summary.slice(0, 120)}</span> : ""}
          </span>
        </div>
      );
    }

    default:
      return null;
  }
}
