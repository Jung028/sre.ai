import Link from "next/link";
import { SeverityBadge } from "./SeverityBadge";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

export function IncidentCard({ incident }: { incident: Incident }) {
  const statusColors: Record<string, string> = {
    investigating: "text-yellow-400",
    investigated: "text-blue-400",
    needs_pr: "text-purple-400",
    resolved: "text-green-400",
  };

  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="block bg-[#17171f] border border-slate-800 rounded-xl p-4 hover:border-indigo-500/40 hover:bg-[#1a1a26] transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge severity={incident.severity} />
            <span className="text-xs text-slate-500">{incident.source}</span>
          </div>
          <h3 className="text-sm font-medium text-slate-100 truncate">{incident.title}</h3>
          {incident.service_name && (
            <p className="text-xs text-slate-500 mt-0.5">
              Service: <code className="text-slate-400">{incident.service_name}</code>
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-xs font-medium ${statusColors[incident.status] ?? "text-slate-400"}`}>
            {incident.status.replace("_", " ")}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            {formatDistanceToNow(incident.triggered_at)}
          </p>
        </div>
      </div>
    </Link>
  );
}
