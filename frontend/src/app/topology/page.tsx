"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Network, AlertTriangle, CheckCircle, Circle } from "lucide-react";
import { api } from "@/lib/api";
import type { TopologyEdge, TopologyNode } from "@/lib/types";

const STATUS_STYLES: Record<string, { card: string; dot: string; icon: React.ReactNode }> = {
  healthy: {
    card: "border-green-500/30 bg-green-500/5",
    dot: "bg-green-400",
    icon: <CheckCircle size={13} className="text-green-400" />,
  },
  warning: {
    card: "border-yellow-500/40 bg-yellow-500/8",
    dot: "bg-yellow-400",
    icon: <AlertTriangle size={13} className="text-yellow-400" />,
  },
  critical: {
    card: "border-red-500/40 bg-red-500/8",
    dot: "bg-red-400",
    icon: <AlertTriangle size={13} className="text-red-400" />,
  },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-slate-400",
};

export default function TopologyPage() {
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.topology
      .get()
      .then(({ nodes, edges }) => {
        setNodes(nodes);
        setEdges(edges);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedNode = nodes.find((n) => n.id === selected);
  const connectedTo = edges.filter((e) => e.source === selected).map((e) => e.target);
  const connectedFrom = edges.filter((e) => e.target === selected).map((e) => e.source);

  const summaryStats = {
    healthy: nodes.filter((n) => n.status === "healthy").length,
    warning: nodes.filter((n) => n.status === "warning").length,
    critical: nodes.filter((n) => n.status === "critical").length,
    totalIncidents: nodes.reduce((sum, n) => sum + n.incident_count, 0),
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Network className="text-indigo-400" size={20} />
          <h1 className="text-xl font-semibold text-white">Service Topology</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{summaryStats.healthy} healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />{summaryStats.warning} warning</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{summaryStats.critical} critical</span>
          <span className="text-slate-600">·</span>
          <span>{summaryStats.totalIncidents} total incidents</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-5">
        {/* Service grid */}
        <div className="flex-1">
          {loading ? (
            <div className="grid grid-cols-3 gap-3">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-800/40 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {nodes.map((node) => {
                const style = STATUS_STYLES[node.status] ?? STATUS_STYLES.healthy;
                const isSelected = selected === node.id;
                const isConnected = connectedTo.includes(node.id) || connectedFrom.includes(node.id);

                return (
                  <button
                    key={node.id}
                    onClick={() => setSelected(isSelected ? null : node.id)}
                    className={`text-left border rounded-xl p-4 transition-all cursor-pointer ${style.card} ${
                      isSelected
                        ? "ring-2 ring-indigo-500 scale-[1.02]"
                        : isConnected
                        ? "ring-1 ring-indigo-500/40 opacity-100"
                        : selected
                        ? "opacity-40"
                        : "hover:scale-[1.01] hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        {style.icon}
                        <span className="text-xs font-medium text-slate-200">{node.label}</span>
                      </div>
                      <span className={`text-xs font-semibold ${SEVERITY_COLOR[node.severity] ?? "text-slate-400"}`}>
                        {node.severity}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {node.incident_count > 0 ? (
                        <span className={node.incident_count >= 3 ? "text-orange-400" : "text-slate-400"}>
                          {node.incident_count} incident{node.incident_count !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-green-500/60">No incidents</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Edge legend */}
          <div className="mt-5 p-4 bg-[var(--bg-surface)] border border-slate-800 rounded-xl">
            <p className="text-xs font-medium text-slate-400 mb-3">Service Dependencies ({edges.length} connections)</p>
            <div className="flex flex-wrap gap-2">
              {edges.map((e, i) => (
                <div
                  key={i}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                    selected && (e.source === selected || e.target === selected)
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                      : "border-slate-800 bg-slate-800/30 text-slate-500"
                  }`}
                >
                  {e.source} → {e.target}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="w-64 flex-shrink-0">
          {selectedNode ? (
            <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl p-4 sticky top-4">
              <div className="flex items-center gap-2 mb-4">
                {STATUS_STYLES[selectedNode.status]?.icon}
                <h3 className="text-sm font-semibold text-white">{selectedNode.label}</h3>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="text-slate-500 mb-1">Status</p>
                  <p className={`font-medium capitalize ${
                    selectedNode.status === "healthy" ? "text-green-400"
                    : selectedNode.status === "warning" ? "text-yellow-400"
                    : "text-red-400"
                  }`}>{selectedNode.status}</p>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">Max Severity</p>
                  <p className={`font-medium ${SEVERITY_COLOR[selectedNode.severity]}`}>{selectedNode.severity}</p>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">Total Incidents</p>
                  <p className="text-slate-200 font-medium">{selectedNode.incident_count}</p>
                </div>

                {connectedTo.length > 0 && (
                  <div>
                    <p className="text-slate-500 mb-1">Calls →</p>
                    <div className="space-y-1">
                      {connectedTo.map((t) => (
                        <button
                          key={t}
                          onClick={() => setSelected(t)}
                          className="block text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {connectedFrom.length > 0 && (
                  <div>
                    <p className="text-slate-500 mb-1">Called by</p>
                    <div className="space-y-1">
                      {connectedFrom.map((s) => (
                        <button
                          key={s}
                          onClick={() => setSelected(s)}
                          className="block text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800">
                  <Link
                    href={`/incidents?service=${selectedNode.id}`}
                    className="text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    View incidents →
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl p-4 text-center text-slate-600">
              <Network size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs">Click a service to see details and connections</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
