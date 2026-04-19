"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ExternalLink, Github } from "lucide-react";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

export default function HistoryPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.incidents
      .list()
      .then((data) => {
        setIncidents(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const resolved = incidents.filter((i) =>
    ["investigated", "needs_pr", "resolved"].includes(i.status)
  );

  const confidenceColor = (c?: string) => {
    if (c === "high") return "text-green-400";
    if (c === "medium") return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Clock className="text-indigo-400" size={20} />
        <h1 className="text-xl font-semibold text-white">RCA History</h1>
        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
          {resolved.length} resolved
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-slate-800/40 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {["Incident", "Service", "Root Cause", "Confidence", "Time", "PR"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resolved.map((inc) => (
                <tr
                  key={inc.id}
                  className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors"
                >
                  <td className="px-4 py-3 max-w-[220px]">
                    <Link
                      href={`/incidents/${inc.id}`}
                      className="flex flex-col gap-1 hover:opacity-80 transition-opacity"
                    >
                      <SeverityBadge severity={inc.severity} />
                      <span className="text-slate-200 text-xs leading-tight truncate">
                        {inc.title}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    <code className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                      {inc.service_name ?? "—"}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs max-w-[260px]">
                    <span className="line-clamp-2 leading-relaxed">
                      {inc.rca?.root_cause ?? (
                        <span className="text-slate-600 italic">No RCA yet</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {inc.rca ? (
                      <span className={`text-xs font-semibold ${confidenceColor(inc.rca.confidence)}`}>
                        ● {inc.rca.confidence}
                      </span>
                    ) : (
                      <span className="text-slate-700 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {formatDistanceToNow(inc.triggered_at)}
                  </td>
                  <td className="px-4 py-3">
                    {inc.rca?.github_pr_url ? (
                      <a
                        href={inc.rca.github_pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-xs"
                        title="View PR"
                      >
                        <Github size={13} />
                        PR
                      </a>
                    ) : (
                      <span className="text-slate-700 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {resolved.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-600 text-sm">
                    <Clock size={32} className="mx-auto mb-3 opacity-20" />
                    No completed investigations yet.
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
