"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";
import { StreamingBubble } from "@/components/investigation/StreamingBubble";
import { RcaPanel } from "@/components/investigation/RcaPanel";
import { useIncidentStream } from "@/lib/useIncidentStream";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { formatDistanceToNow } from "@/lib/utils";

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);

  const isLive = incident?.status === "investigating";
  const { events, rca: streamedRca, status } = useIncidentStream(isLive ? id : null);

  useEffect(() => {
    api.incidents
      .get(id)
      .then(setIncident)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading incident...
      </div>
    );
  }

  if (!incident) {
    return <p className="text-slate-500">Incident not found.</p>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/incidents"
          className="text-slate-500 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <SeverityBadge severity={incident.severity} />
        <h1 className="text-lg font-semibold text-white truncate">{incident.title}</h1>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Service", value: incident.service_name ?? "unknown" },
          { label: "Source", value: incident.source },
          { label: "Triggered", value: formatDistanceToNow(incident.triggered_at) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#17171f] border border-slate-800 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="text-sm text-slate-200">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            {isLive ? "Live Investigation" : "Investigation Log"}
          </h2>
          <StreamingBubble events={events} status={status} />
        </div>

        <div>
          <h2 className="text-sm font-medium text-slate-300 mb-3">Root Cause Analysis</h2>
          <div className="bg-[#17171f] border border-slate-800 rounded-xl p-4 min-h-[20rem]">
            <RcaPanel rca={incident.rca} streamedText={streamedRca} />
          </div>
        </div>
      </div>
    </div>
  );
}
