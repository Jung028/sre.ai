"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy, FileCode, GitPullRequest, Lightbulb } from "lucide-react";
import type { RCA, CodeContext } from "@/lib/types";

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <><Check size={11} className="text-green-400" /><span className="text-green-400">Copied</span></>
      ) : (
        <><Copy size={11} /><span>Copy</span></>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock — dark editor-style pre block with line numbers + copy button
// ---------------------------------------------------------------------------
function CodeBlock({ code, label }: { code: string; label: string }) {
  const lines = code.split("\n");
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
        <span className="text-xs text-slate-500 font-mono">{label}</span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto bg-slate-900">
        <table className="w-full">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-slate-800/50">
                <td className="select-none text-right text-slate-600 font-mono text-xs px-3 py-0 w-10 align-top leading-5 pt-0.5">
                  {i + 1}
                </td>
                <td className="font-mono text-xs text-slate-200 px-3 py-0 whitespace-pre leading-5 pt-0.5 pb-0.5">
                  {line || "\u00A0"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffBlock — unified diff view (before vs after)
// Computes a simple line-based LCS diff and renders GitHub-style +/- lines.
// ---------------------------------------------------------------------------
type DiffLine =
  | { type: "context"; text: string; oldNum: number; newNum: number }
  | { type: "removed"; text: string; oldNum: number }
  | { type: "added"; text: string; newNum: number };

function computeDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  let oldNum = 1, newNum = 1;

  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type: "context", text: oldLines[i], oldNum, newNum });
      i++; j++; oldNum++; newNum++;
    } else if (j < n && (i >= m || dp[i + 1][j] <= dp[i][j + 1])) {
      result.push({ type: "added", text: newLines[j], newNum });
      j++; newNum++;
    } else {
      result.push({ type: "removed", text: oldLines[i], oldNum });
      i++; oldNum++;
    }
  }

  return result;
}

function DiffBlock({ before, after }: { before: string; after: string }) {
  const lines = computeDiff(before, after);
  const patchText = lines
    .map(l => l.type === "added" ? `+ ${l.text}` : l.type === "removed" ? `- ${l.text}` : `  ${l.text}`)
    .join("\n");

  return (
    <div className="rounded-lg overflow-hidden border border-slate-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
        <span className="text-xs text-slate-500 font-mono">unified diff</span>
        <CopyButton text={patchText} />
      </div>
      <div className="overflow-x-auto bg-slate-950">
        <table className="w-full">
          <tbody>
            {lines.map((line, idx) => {
              const isAdded = line.type === "added";
              const isRemoved = line.type === "removed";
              const oldNumStr = "oldNum" in line ? String(line.oldNum) : "";
              const newNumStr = "newNum" in line ? String(line.newNum) : "";
              return (
                <tr
                  key={idx}
                  className={
                    isAdded
                      ? "bg-green-950/60"
                      : isRemoved
                      ? "bg-red-950/60"
                      : "hover:bg-slate-800/30"
                  }
                >
                  {/* old line number */}
                  <td className="select-none text-right font-mono text-xs text-slate-600 px-2 py-0 w-8 leading-5 pt-0.5">
                    {oldNumStr}
                  </td>
                  {/* new line number */}
                  <td className="select-none text-right font-mono text-xs text-slate-600 px-2 py-0 w-8 leading-5 pt-0.5">
                    {newNumStr}
                  </td>
                  {/* sign column */}
                  <td
                    className={`select-none font-mono text-xs px-1 py-0 w-5 leading-5 pt-0.5 font-bold ${
                      isAdded ? "text-green-400" : isRemoved ? "text-red-400" : "text-slate-600"
                    }`}
                  >
                    {isAdded ? "+" : isRemoved ? "−" : " "}
                  </td>
                  {/* code */}
                  <td
                    className={`font-mono text-xs px-2 py-0 whitespace-pre leading-5 pt-0.5 pb-0.5 ${
                      isAdded
                        ? "text-green-200"
                        : isRemoved
                        ? "text-red-200"
                        : "text-slate-300"
                    }`}
                  >
                    {line.text || "\u00A0"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileBreadcrumb — "payment-service / src / db / pool.py · Class.fn() : 43"
// ---------------------------------------------------------------------------
function FileBreadcrumb({ ctx }: { ctx: CodeContext }) {
  const parts = ctx.file_path.split("/");
  const qualifier =
    ctx.class_name && ctx.function_name
      ? `${ctx.class_name}.${ctx.function_name}()`
      : ctx.function_name
      ? `${ctx.function_name}()`
      : ctx.class_name ?? null;

  return (
    <div className="flex items-center gap-1 flex-wrap font-mono text-xs text-slate-400 min-w-0">
      <FileCode size={12} className="text-indigo-400 flex-shrink-0" />
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          {i > 0 && <span className="text-slate-600">/</span>}
          <span className={i === parts.length - 1 ? "text-slate-200" : "text-slate-400 truncate"}>
            {part}
          </span>
        </span>
      ))}
      {qualifier && (
        <><span className="text-slate-600">·</span><span className="text-indigo-300">{qualifier}</span></>
      )}
      {ctx.line_number != null && (
        <><span className="text-slate-600">:</span><span className="text-yellow-400">{ctx.line_number}</span></>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodeContextCard — 3-tab card: Problem | Fix | Diff
// ---------------------------------------------------------------------------
type Tab = "problem" | "fix" | "diff";

const TABS: { id: Tab; label: string; activeClass: string }[] = [
  { id: "problem", label: "Problematic Code", activeClass: "text-red-400 border-red-400 bg-red-400/5" },
  { id: "fix",     label: "Suggested Fix",    activeClass: "text-green-400 border-green-400 bg-green-400/5" },
  { id: "diff",    label: "Diff",             activeClass: "text-indigo-400 border-indigo-400 bg-indigo-400/5" },
];

function CodeContextCard({ ctx }: { ctx: CodeContext }) {
  const [tab, setTab] = useState<Tab>("problem");

  return (
    <div className="rounded-xl border border-slate-700 bg-[var(--bg-deep)] overflow-hidden">
      {/* header — file path */}
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/40">
        <FileBreadcrumb ctx={ctx} />
      </div>

      {/* tabs */}
      <div className="flex border-b border-slate-700">
        {TABS.map(({ id, label, activeClass }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              tab === id ? `${activeClass} border-current` : "text-slate-500 hover:text-slate-300 border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* code content */}
      <div className="p-3">
        {tab === "problem" && <CodeBlock code={ctx.snippet} label="before.py" />}
        {tab === "fix"     && <CodeBlock code={ctx.suggested_fix} label="after.py" />}
        {tab === "diff"    && <DiffBlock before={ctx.snippet} after={ctx.suggested_fix} />}
      </div>

      {/* change description */}
      <div className="mx-3 mb-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
        <Lightbulb size={13} className="text-indigo-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-indigo-200 leading-relaxed">{ctx.change_description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RcaPanel — main export
// ---------------------------------------------------------------------------
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
    <div className="space-y-5">
      {/* Root cause + confidence */}
      {rca && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <p className="text-xs text-slate-500 mb-1">Root Cause</p>
            <p className="text-sm text-slate-100 leading-relaxed">{rca.root_cause}</p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <p className="text-xs text-slate-500 mb-1">Confidence</p>
            <span
              className={`text-sm font-semibold ${
                rca.confidence === "high" ? "text-green-400"
                : rca.confidence === "medium" ? "text-yellow-400"
                : "text-red-400"
              }`}
            >
              {rca.confidence.charAt(0).toUpperCase() + rca.confidence.slice(1)}
            </span>
          </div>
        </div>
      )}

      {/* Summary markdown */}
      <div className="prose prose-sm prose-invert max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {/* Code Context */}
      {rca?.code_context && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Code Context</h4>
          <CodeContextCard ctx={rca.code_context} />
        </div>
      )}

      {/* PR button */}
      {rca && (
        <div className="pt-1">
          {rca.github_pr_url ? (
            <a
              href={rca.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              <GitPullRequest size={15} />
              View Fix PR →
            </a>
          ) : rca.needs_pr ? (
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-500 text-sm rounded-lg border border-slate-700 cursor-not-allowed select-none">
              <GitPullRequest size={15} />
              PR not yet created
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
