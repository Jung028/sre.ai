"use client";

import { useEffect, useState, useMemo } from "react";
import { Activity, Calendar, Download, RefreshCw, Search, X } from "lucide-react";
import { IncidentCard } from "@/components/incidents/IncidentCard";
import { api } from "@/lib/api";
import type { Incident } from "@/lib/types";

// ─── Date filter helpers ──────────────────────────────────────────────────────
type DateFilter = "today" | "week" | "custom";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function withinFilter(
  isoStr: string,
  filter: DateFilter,
  customFrom: string,
  customTo: string,
): boolean {
  const d = new Date(isoStr);
  const now = new Date();
  if (filter === "today") return d >= startOfDay();
  if (filter === "week") {
    const wk = new Date(now);
    wk.setDate(wk.getDate() - 7);
    return d >= wk;
  }
  if (filter === "custom") {
    const from = customFrom ? new Date(customFrom) : new Date(0);
    const to   = customTo   ? new Date(customTo)   : now;
    return d >= from && d <= to;
  }
  return true;
}

// ─── CSV export ───────────────────────────────────────────────────────────────
function minutesBetween(a: string, b: string | null): string {
  if (!b) return "";
  const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return diff >= 0 ? String(diff) : "";
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
}

function downloadCSV(incidents: Incident[]) {
  const SLA_MINUTES = 5;
  const headers = [
    "ID",
    "Trace ID",
    "Title",
    "Error Message",
    "Urgency",
    "Service",
    "Source / Method",
    "Time of Occurrence",
    "Error Logs (summary)",
    "Resolution",
    "Resolved At",
    "Response Time (min)",
    "Resolution Time (min)",
    "SLA Met (≤5 min ack)",
  ];

  const rows = incidents.map((inc) => {
    const resolutionTime = minutesBetween(inc.triggered_at, inc.resolved_at);
    const responseSLA    = resolutionTime !== "" && Number(resolutionTime) <= SLA_MINUTES ? "Yes" : "No";

    // Extract a compact log summary from the RCA summary text
    const logSummary = inc.rca?.summary
      ? inc.rca.summary
          .replace(/#+\s+/g, "")
          .replace(/\*\*/g, "")
          .replace(/`/g, "")
          .slice(0, 300)
      : "";

    return [
      inc.id,
      inc.trace_id ?? "",
      inc.title,
      inc.rca?.root_cause ?? "",
      inc.severity.toUpperCase(),
      inc.service_name ?? "",
      inc.source,
      new Date(inc.triggered_at).toLocaleString(),
      logSummary,
      inc.rca?.root_cause
        ? `RESOLVED: ${inc.rca.root_cause.slice(0, 200)}`
        : inc.status === "resolved" ? "Resolved (no RCA)" : "",
      inc.resolved_at ? new Date(inc.resolved_at).toLocaleString() : "",
      resolutionTime,
      resolutionTime,
      responseSLA,
    ].map(csvCell).join(",");
  });

  const bom  = "\uFEFF"; // UTF-8 BOM so Excel opens correctly
  const csv  = bom + [headers.map(csvCell).join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Status filter tabs ───────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: "all",           label: "All"           },
  { key: "investigating", label: "Investigating"  },
  { key: "needs_pr",      label: "Needs PR"       },
  { key: "resolved",      label: "Resolved"       },
];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function IncidentsPage() {
  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [search,       setSearch]       = useState("");
  const [dateFilter,   setDateFilter]   = useState<DateFilter>("week");
  const [customFrom,   setCustomFrom]   = useState("");
  const [customTo,     setCustomTo]     = useState("");
  const [showCustom,   setShowCustom]   = useState(false);

  async function load(spinner = false) {
    if (spinner) setRefreshing(true);
    try {
      const data = await api.incidents.list();
      // Sort: latest first (default)
      data.sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime());
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
    const iv = setInterval(() => load(), 15_000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allIncidents.filter((inc) => {
      if (statusFilter !== "all" && inc.status !== statusFilter) return false;
      if (!withinFilter(inc.triggered_at, dateFilter, customFrom, customTo)) return false;
      if (q) {
        return (
          inc.title.toLowerCase().includes(q) ||
          (inc.service_name ?? "").toLowerCase().includes(q) ||
          (inc.trace_id ?? "").toLowerCase().includes(q) ||
          inc.external_id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allIncidents, statusFilter, dateFilter, customFrom, customTo, search]);

  return (
    <div className="max-w-5xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Activity className="text-indigo-400" size={20} />
          <h1 className="text-xl font-semibold text-white">Incidents</h1>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Download */}
          <button
            onClick={() => downloadCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download size={13} />
            Export CSV
          </button>

          {/* Refresh */}
          <button
            onClick={() => load(true)}
            className={`p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ${refreshing ? "animate-spin" : ""}`}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ── Date filter strip ── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Calendar size={13} className="text-slate-500 flex-shrink-0" />
        {(["today", "week"] as DateFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => { setDateFilter(f); setShowCustom(false); }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              dateFilter === f && !showCustom
                ? "bg-indigo-600 text-white"
                : "bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700/60"
            }`}
          >
            {f === "today" ? "Today" : "This Week"}
          </button>
        ))}
        <button
          onClick={() => { setDateFilter("custom"); setShowCustom((v) => !v); }}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            dateFilter === "custom"
              ? "bg-indigo-600 text-white"
              : "bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700/60"
          }`}
        >
          Custom range
        </button>

        {/* Custom pickers */}
        {showCustom && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500"
            />
            <span className="text-slate-600 text-xs">→</span>
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <div className="relative mb-3">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, service, trace ID…"
          className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-8 pr-8 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/30 transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Status tabs ── */}
      <div className="flex gap-1.5 mb-5">
        {STATUS_TABS.map(({ key, label }) => {
          const count = key === "all"
            ? allIncidents.length
            : allIncidents.filter((i) => i.status === key).length;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800/60 text-slate-400 hover:text-white border border-slate-700/50"
              }`}
            >
              {label}
              <span className={`ml-1.5 ${statusFilter === key ? "text-indigo-200" : "text-slate-600"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Incident list ── */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-800/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-slate-600">
          <Activity size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm text-slate-500">No incidents match the current filters.</p>
          <button
            onClick={() => { setDateFilter("week"); setStatusFilter("all"); setSearch(""); }}
            className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))}
        </div>
      )}
    </div>
  );
}
