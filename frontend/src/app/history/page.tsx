"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ExternalLink } from "lucide-react";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

export default function HistoryPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.incidents.list().then(setIncidents).finally(() => setLoading(false));
  }, []);

  const resolved = incidents.filter((i) =>
    ["investigated", "needs_pr", "resolved"].includes(i.status)
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Clock className="text-indigo-400" size={20} />
        <h1 className="text-xl font-semibold text-white">RCA History</h1>
        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
          {resolved.length}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-800/40 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-[#17171f] border border-slate-800 rounded-xl overflow-hidden">
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
                  <td className="px-4 py-3">
                    <Link
                      href={`/incidents/${inc.id}`}
                      className="text-indigo-400 hover:text-indigo-300 transition-colors truncate block max-w-[200px]"
                    >
                      <SeverityBadge severity={inc.severity} />
                      <span className="ml-2 text-slate-200 text-xs">{inc.title.slice(0, 40)}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    <code>{inc.service_name ?? "—"}</code>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs max-w-[220px] truncate">
                    {inc.rca?.root_cause ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {inc.rca ? (
                      <span
                        className={`text-xs font-medium ${
                          inc.rca.confidence === "high"
                            ? "text-green-400"
                            : inc.rca.confidence === "medium"
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {inc.rca.confidence}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {formatDistanceToNow(inc.triggered_at)}
                  </td>
                  <td className="px-4 py-3">
                    {inc.rca?.github_pr_url ? (
                      <a
                        href={inc.rca.github_pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {resolved.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-600 text-sm">
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
