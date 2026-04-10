"use client";

import ReactMarkdown from "react-markdown";
import type { RCA } from "@/lib/types";

interface Props {
  rca: RCA | null | undefined;
  streamedText?: string | null;
}

export function RcaPanel({ rca, streamedText }: Props) {
  const content = rca?.summary ?? streamedText;

  if (!content) {
    return (
      <div className="text-sm text-slate-500 italic">
        RCA will appear here once the investigation completes.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rca && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Root Cause</p>
            <p className="text-sm text-slate-100">{rca.root_cause}</p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Confidence</p>
            <span
              className={`text-sm font-medium ${
                rca.confidence === "high"
                  ? "text-green-400"
                  : rca.confidence === "medium"
                  ? "text-yellow-400"
                  : "text-red-400"
              }`}
            >
              {rca.confidence}
            </span>
          </div>
        </div>
      )}

      <div className="prose prose-sm prose-invert max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {rca?.github_pr_url && (
        <a
          href={rca.github_pr_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          View Fix PR →
        </a>
      )}
    </div>
  );
}
