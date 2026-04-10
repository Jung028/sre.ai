"use client";

import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { api } from "@/lib/api";
import type { TopologyEdge, TopologyNode } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  healthy: "bg-green-500/20 border-green-500/40 text-green-300",
  warning: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300",
  critical: "bg-red-500/20 border-red-500/40 text-red-300",
};

export default function TopologyPage() {
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.topology.get().then(({ nodes }) => setNodes(nodes)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Network className="text-indigo-400" size={20} />
        <h1 className="text-xl font-semibold text-white">Service Topology</h1>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-800/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <div className="text-center py-20 text-slate-600">
          <Network size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No services detected yet. Topology builds from incident history.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {nodes.map((node) => (
            <div
              key={node.id}
              className={`border rounded-xl p-4 ${STATUS_COLORS[node.status] ?? STATUS_COLORS.warning}`}
            >
              <p className="font-medium text-sm">{node.label}</p>
              <p className="text-xs mt-1 opacity-70">
                {node.incident_count} incident{node.incident_count !== 1 ? "s" : ""}
              </p>
              <span className="text-xs mt-2 inline-block opacity-60">{node.status}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-600 mt-6">
        Topology is derived from incident history. Full graph visualization with @xyflow/react
        available once edge data is configured.
      </p>
    </div>
  );
}
