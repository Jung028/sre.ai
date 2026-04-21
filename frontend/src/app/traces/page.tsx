"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Search } from "lucide-react";

// Example trace IDs shown as quick links
const EXAMPLE_TRACES = [
  { id: "4bf92f3577b34da6a3ce929d0e0e4736", label: "payment-service · DB pool exhausted", status: "error"  },
  { id: "a3c2b1d4e5f6789012345678abcdef01",  label: "auth-service · slow login (4.3s)",    status: "slow"   },
  { id: "7f1e3d2c4b5a6978091234567890abcd",  label: "notification-worker · template error", status: "error"  },
  { id: "b2c3d4e5f6a1789056789012345678ab",  label: "user-service · OOMKilled restart",     status: "error"  },
  { id: "9e8d7c6b5a4312f0abcdef0123456789",  label: "search-service · wildcard scan 8.2s", status: "slow"   },
];

const STATUS_DOT: Record<string, string> = {
  error: "bg-red-500",
  slow:  "bg-yellow-400",
  ok:    "bg-green-400",
};

export default function TracesPage() {
  const [traceId, setTraceId] = useState("");
  const router    = useRouter();

  function navigate(id: string) {
    const clean = id.trim();
    if (clean) router.push(`/traces/${clean}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate(traceId);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[72vh] px-4">
      {/* Icon + heading */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <GitFork size={18} className="text-indigo-400" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Trace Explorer</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8 text-center max-w-xs">
        Enter a trace ID to inspect distributed service calls, logs, and connection details.
      </p>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="w-full max-w-lg">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            autoFocus
            type="text"
            value={traceId}
            onChange={(e) => setTraceId(e.target.value)}
            placeholder="Paste trace ID…"
            className="w-full bg-[var(--bg-surface)] border border-slate-700 rounded-xl pl-11 pr-32 py-3.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-lg"
          />
          <button
            type="submit"
            disabled={!traceId.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            Explore →
          </button>
        </div>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3 mt-8 mb-4 w-full max-w-lg">
        <div className="flex-1 border-t border-slate-800" />
        <span className="text-[11px] text-slate-600 uppercase tracking-wide">Recent traces</span>
        <div className="flex-1 border-t border-slate-800" />
      </div>

      {/* Quick-access examples */}
      <ul className="w-full max-w-lg space-y-1.5">
        {EXAMPLE_TRACES.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => navigate(t.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-surface)] hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 rounded-xl transition-all text-left group"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[t.status]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors truncate">{t.label}</p>
                <p className="text-[10px] font-mono text-slate-600 truncate mt-0.5">{t.id}</p>
              </div>
              <GitFork size={12} className="text-slate-700 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
