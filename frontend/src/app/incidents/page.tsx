"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw, Search, X } from "lucide-react";
import { IncidentCard } from "@/components/incidents/IncidentCard";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "investigating", label: "Investigating" },
  { key: "needs_pr", label: "Needs PR" },
  { key: "resolved", label: "Resolved" },
];

export default function IncidentsPage() {
  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    try {
      const data = await api.incidents.list();
      setAllIncidents(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 15000);
    return () => clearInterval(interval);
  }, []);

  const q = search.trim().toLowerCase();
  const incidents = allIncidents.filter((i) => {
    const matchesFilter = filter === "all" || i.status === filter;
    const matchesSearch =
      !q ||
      i.title.toLowerCase().includes(q) ||
      (i.service_name ?? "").toLowerCase().includes(q) ||
      (i.trace_id ?? "").toLowerCase().includes(q) ||
      i.external_id.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="text-indigo-400" size={22} />
          <h1 className="text-xl font-semibold text-white">Incidents</h1>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
            {incidents.length}
          </span>
        </div>
        <button
          onClick={() => load(true)}
          className={`p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ${
            refreshing ? "animate-spin" : ""
          }`}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, service, or trace ID…"
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg pl-8 pr-8 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === key
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {label}
            <span className="ml-1.5 text-slate-500">
              {key === "all"
                ? allIncidents.length
                : allIncidents.filter((i) => i.status === key).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : incidents.length === 0 ? (
        <div className="text-center py-20 text-slate-600">
          <Activity size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No incidents found. All systems green.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))}
        </div>
      )}
    </div>
  );
}
