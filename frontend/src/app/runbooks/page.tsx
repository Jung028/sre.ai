"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface Runbook {
  id: string;
  service_name: string;
  source: string;
  updated_at: string;
  content: string;
}

function markdownToHtml(md: string): string {
  return md
    // Headers
    .replace(/^### (.+)$/gm, "<h3 class=\"text-sm font-semibold text-slate-200 mt-4 mb-1\">$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class=\"text-base font-semibold text-white mt-5 mb-2\">$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class=\"text-lg font-bold text-white mt-5 mb-2\">$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong class=\"text-slate-100 font-semibold\">$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em class=\"text-slate-300\">$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code class=\"bg-slate-800 text-indigo-300 px-1 py-0.5 rounded text-xs font-mono\">$1</code>")
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, "<li class=\"ml-4 list-disc text-slate-300\">$1</li>")
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, "<li class=\"ml-4 list-decimal text-slate-300\">$1</li>")
    // Newlines to <br> for non-tag lines
    .replace(/\n(?!<)/g, "<br />");
}

function RunbookCard({ runbook }: { runbook: Runbook }) {
  const [expanded, setExpanded] = useState(false);

  const preview = runbook.content.slice(0, 200);
  const hasMore = runbook.content.length > 200;
  const updatedDate = new Date(runbook.updated_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl overflow-hidden transition-all">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <code className="text-indigo-300 text-sm font-mono font-semibold">{runbook.service_name}</code>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 font-medium">
                {runbook.source}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-2">{updatedDate}</p>
            <p className="text-sm text-slate-400 line-clamp-2">
              {preview}{hasMore && !expanded ? "…" : ""}
            </p>
          </div>
          <div className="flex-shrink-0 text-slate-500 mt-1">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 px-5 py-4">
          <div
            className="text-sm text-slate-400 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(runbook.content) }}
          />
        </div>
      )}
    </div>
  );
}

export default function RunbooksPage() {
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/runbooks", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load runbooks: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setRunbooks(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load runbooks"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen className="text-indigo-400" size={22} />
        <h1 className="text-xl font-semibold text-white">Runbooks</h1>
        {!loading && (
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
            {runbooks.length}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-500">
          <Loader2 className="animate-spin mr-2" size={18} />
          Loading runbooks...
        </div>
      ) : runbooks.length === 0 ? (
        <div className="text-center py-20 text-slate-600">
          <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-slate-500 mb-1">No runbooks generated yet.</p>
          <p className="text-xs text-slate-600">
            Runbooks are auto-created after each investigation.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {runbooks.map((rb) => (
            <RunbookCard key={rb.id} runbook={rb} />
          ))}
        </div>
      )}
    </div>
  );
}
