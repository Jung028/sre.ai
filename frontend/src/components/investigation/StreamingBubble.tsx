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
    <div className="bg-[#0d0d14] border border-slate-800 rounded-xl p-4 h-80 overflow-y-auto scrollbar-thin font-mono text-xs space-y-2">
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

function EventLine({ event }: { event: StreamEvent }) {
  switch (event.type) {
    case "thought":
      return (
        <div className="flex gap-2 text-slate-400">
          <Brain size={11} className="mt-0.5 flex-shrink-0 text-indigo-400" />
          <span className="whitespace-pre-wrap">{(event.data as { text: string }).text?.slice(0, 200)}</span>
        </div>
      );
    case "tool_start":
      return (
        <div className="flex gap-2 text-yellow-400">
          <Terminal size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            calling <strong>{(event.data as { name: string }).name}</strong>
            {(event.data as { inputs?: Record<string, unknown> }).inputs?.service
              ? ` → ${(event.data as { inputs: { service: string } }).inputs.service}`
              : ""}
          </span>
        </div>
      );
    case "tool_end":
      const d = event.data as { name: string; success: boolean; summary?: string };
      return (
        <div className={`flex gap-2 ${d.success ? "text-green-400" : "text-red-400"}`}>
          {d.success ? <CheckCircle size={11} className="mt-0.5 flex-shrink-0" /> : <XCircle size={11} className="mt-0.5 flex-shrink-0" />}
          <span>
            {d.name} {d.success ? "✓" : "✗"}
            {d.summary ? ` — ${d.summary.slice(0, 120)}` : ""}
          </span>
        </div>
      );
    default:
      return null;
  }
}
