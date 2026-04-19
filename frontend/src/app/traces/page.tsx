"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GitFork } from "lucide-react";
import { api } from "@/lib/api";
import { TRACE_IDS } from "@/lib/mockData";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";

export default function TracesIndexPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.incidents.list().then(setIncidents).finally(() => setLoading(false));
  }, []);

  const traced = incidents.filter((i) => i.trace_id);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <GitFork className="text-indigo-400" size={20} />
        <h1 className="text-xl font-semibold text-white">Traces</h1>
        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{traced.length}</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {["Trace ID", "Incident", "Service", "Status", "Time"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traced.map((inc) => (
                <tr key={inc.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/traces/${inc.trace_id}`}
                      className="flex items-center gap-1.5 font-mono text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      <GitFork size={11} />
                      {inc.trace_id?.slice(0, 16)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/incidents/${inc.id}`} className="flex flex-col gap-0.5 hover:opacity-80 transition-opacity">
                      <SeverityBadge severity={inc.severity} />
                      <span className="text-xs text-slate-300 truncate max-w-[200px]">{inc.title}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs text-slate-300">{inc.service_name ?? "—"}</code>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${
                      inc.status === "investigating" ? "text-yellow-400"
                      : inc.status === "needs_pr" ? "text-purple-400"
                      : inc.status === "resolved" ? "text-green-400"
                      : "text-blue-400"
                    }`}>{inc.status.replace("_", " ")}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDistanceToNow(inc.triggered_at)}</td>
                </tr>
              ))}
              {traced.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-slate-600 text-sm">
                    <GitFork size={32} className="mx-auto mb-3 opacity-20" />
                    No traces found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
