"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  ExternalLink,
  FileCode,
  GitCommit,
  GitPullRequest,
  Lightbulb,
  ScrollText,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { RCA, Evidence, CodeContext } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Confidence meter — filled dots
// ─────────────────────────────────────────────────────────────────────────────
function ConfidenceMeter({ level }: { level: "high" | "medium" | "low" }) {
  const map = {
    high:   { dots: 3, color: "bg-green-400",  text: "text-green-400",  label: "High" },
    medium: { dots: 2, color: "bg-yellow-400", text: "text-yellow-400", label: "Medium" },
    low:    { dots: 1, color: "bg-red-400",    text: "text-red-400",    label: "Low" },
  };
  const { dots, color, text, label } = map[level];
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`w-2.5 h-2.5 rounded-full ${n <= dots ? color : "bg-slate-700"}`}
          />
        ))}
      </div>
      <span className={`text-xs font-semibold uppercase tracking-wide ${text}`}>{label} Confidence</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error-rate sparkline SVG
// ─────────────────────────────────────────────────────────────────────────────
function ErrorSparkline() {
  // y=0 top (bad/high error), y=30 bottom (good/low error)
  const pts = "0,29 18,29 28,29 36,26 44,2 54,3 70,4 100,4";
  return (
    <svg viewBox="0 0 100 30" className="w-full h-8" preserveAspectRatio="none">
      <defs>
        <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${pts} 100,30`} fill="url(#errGrad)" />
      <polyline points={pts} fill="none" stroke="#ef4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {/* spike dot */}
      <circle cx="44" cy="2" r="2" fill="#ef4444" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence rail — 4 horizontal cards
// ─────────────────────────────────────────────────────────────────────────────
const EVIDENCE_ICONS: Record<Evidence["type"], React.ReactNode> = {
  metric: <TrendingUp size={14} className="text-red-400" />,
  log:    <ScrollText size={14} className="text-orange-400" />,
  deploy: <GitCommit size={14} className="text-indigo-400" />,
  code:   <FileCode size={14} className="text-violet-400" />,
  trace:  <Zap size={14} className="text-cyan-400" />,
};

const EVIDENCE_ACCENT: Record<Evidence["type"], string> = {
  metric: "border-red-500/20 bg-red-500/5",
  log:    "border-orange-500/20 bg-orange-500/5",
  deploy: "border-indigo-500/20 bg-indigo-500/5",
  code:   "border-violet-500/20 bg-violet-500/5",
  trace:  "border-cyan-500/20 bg-cyan-500/5",
};

function EvidenceRail({ evidence }: { evidence: Evidence[] }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {evidence.map((ev, i) => (
        <div
          key={i}
          className={`rounded-xl border p-3 ${EVIDENCE_ACCENT[ev.type]}`}
        >
          <div className="flex items-center gap-1.5 mb-2">
            {EVIDENCE_ICONS[ev.type]}
            <span className="text-xs text-slate-500 font-medium">{ev.label}</span>
          </div>

          {/* Metric gets special treatment — sparkline */}
          {ev.type === "metric" ? (
            <>
              <div className="flex items-end justify-between mb-1">
                <span className="text-xl font-bold text-red-400 leading-none">{ev.value}</span>
                {ev.delta && (
                  <span className="text-xs text-slate-500 font-mono">{ev.delta}</span>
                )}
              </div>
              <ErrorSparkline />
            </>
          ) : (
            <>
              <p className="text-base font-bold text-slate-100 leading-tight mb-1 font-mono">
                {ev.value}
              </p>
            </>
          )}

          {ev.detail && (
            <p className="text-xs text-slate-500 leading-snug mt-1 line-clamp-2">{ev.detail}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────
const TIMELINE_EVENT_STYLE = (event: string): { dot: string; icon?: string } => {
  const e = event.toLowerCase();
  if (e.includes("deploy") || e.includes("rolled"))
    return { dot: "bg-indigo-500 ring-indigo-500/30" };
  if (e.includes("alert") || e.includes("pagerduty") || e.includes("fired"))
    return { dot: "bg-orange-500 ring-orange-500/30" };
  if (e.includes("peak") || e.includes("error") || e.includes("exhaustion"))
    return { dot: "bg-red-500 ring-red-500/30" };
  if (e.includes("complete") || e.includes("investigation") || e.includes("pr"))
    return { dot: "bg-green-500 ring-green-500/30" };
  return { dot: "bg-slate-500 ring-slate-500/30" };
};

function Timeline({ entries }: { entries: RCA["timeline"] }) {
  return (
    <div className="space-y-0">
      {entries.map((entry, i) => {
        const { dot } = TIMELINE_EVENT_STYLE(entry.event);
        const isLast = i === entries.length - 1;
        const time = new Date(entry.ts).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        return (
          <div key={i} className="flex gap-3">
            {/* spine */}
            <div className="flex flex-col items-center w-5 flex-shrink-0">
              <div className={`w-3 h-3 rounded-full ring-4 ring-offset-0 flex-shrink-0 mt-0.5 ${dot}`} />
              {!isLast && <div className="w-px flex-1 bg-slate-800 mt-1 mb-0" />}
            </div>
            {/* content */}
            <div className={`pb-4 min-w-0 ${isLast ? "" : ""}`}>
              <p className="font-mono text-xs text-slate-500 mb-0.5">{time}</p>
              <p className="text-sm text-slate-200 leading-snug">{entry.event}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code context — 3-tab (reused logic from RcaPanel)
// ─────────────────────────────────────────────────────────────────────────────
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
    >
      {copied ? (
        <><Check size={11} className="text-green-400" /><span className="text-green-400">Copied</span></>
      ) : (
        <><Copy size={11} /><span>Copy</span></>
      )}
    </button>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const lines = code.split("\n");
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
        <span className="text-xs text-slate-500 font-mono">{label}</span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto bg-slate-950">
        <table className="w-full">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-slate-800/40">
                <td className="select-none text-right text-slate-700 font-mono text-xs px-3 w-9 align-top leading-5 pt-0.5">
                  {i + 1}
                </td>
                <td className="font-mono text-xs text-slate-200 px-3 whitespace-pre leading-5 pt-0.5 pb-0.5">
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

// LCS unified diff
type DiffLine =
  | { type: "context"; text: string; oldN: number; newN: number }
  | { type: "removed"; text: string; oldN: number }
  | { type: "added";   text: string; newN: number };

function computeDiff(a: string, b: string): DiffLine[] {
  const A = a.split("\n"), B = b.split("\n");
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? 1 + dp[i+1][j+1] : Math.max(dp[i+1][j], dp[i][j+1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0, on = 1, nn = 1;
  while (i < m || j < n) {
    if (i < m && j < n && A[i] === B[j]) {
      out.push({ type: "context", text: A[i], oldN: on++, newN: nn++ }); i++; j++;
    } else if (j < n && (i >= m || dp[i+1][j] <= dp[i][j+1])) {
      out.push({ type: "added",   text: B[j], newN: nn++ }); j++;
    } else {
      out.push({ type: "removed", text: A[i], oldN: on++ }); i++;
    }
  }
  return out;
}

function DiffBlock({ before, after }: { before: string; after: string }) {
  const lines = computeDiff(before, after);
  const patch = lines.map(l => l.type === "added" ? `+ ${l.text}` : l.type === "removed" ? `- ${l.text}` : `  ${l.text}`).join("\n");
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
        <span className="text-xs text-slate-500 font-mono">unified diff</span>
        <CopyButton text={patch} />
      </div>
      <div className="overflow-x-auto bg-slate-950">
        <table className="w-full">
          <tbody>
            {lines.map((l, idx) => {
              const isAdd = l.type === "added", isDel = l.type === "removed";
              return (
                <tr key={idx} className={isAdd ? "bg-green-950/70" : isDel ? "bg-red-950/70" : "hover:bg-slate-800/30"}>
                  <td className="select-none text-right font-mono text-xs text-slate-700 px-2 w-7 leading-5 pt-0.5">
                    {"oldN" in l ? l.oldN : ""}
                  </td>
                  <td className="select-none text-right font-mono text-xs text-slate-700 px-2 w-7 leading-5 pt-0.5">
                    {"newN" in l ? l.newN : ""}
                  </td>
                  <td className={`select-none font-mono text-xs px-1 w-4 leading-5 pt-0.5 font-bold ${isAdd ? "text-green-400" : isDel ? "text-red-400" : "text-slate-700"}`}>
                    {isAdd ? "+" : isDel ? "−" : " "}
                  </td>
                  <td className={`font-mono text-xs px-2 whitespace-pre leading-5 pt-0.5 pb-0.5 ${isAdd ? "text-green-200" : isDel ? "text-red-200" : "text-slate-300"}`}>
                    {l.text || "\u00A0"}
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

type TabId = "problem" | "fix" | "diff";
const TABS: { id: TabId; label: string; active: string }[] = [
  { id: "problem", label: "Problematic Code", active: "text-red-400 border-red-400 bg-red-400/5" },
  { id: "fix",     label: "Suggested Fix",    active: "text-green-400 border-green-400 bg-green-400/5" },
  { id: "diff",    label: "Diff",             active: "text-indigo-400 border-indigo-400 bg-indigo-400/5" },
];

function CodeContextCard({ ctx }: { ctx: CodeContext }) {
  const [tab, setTab] = useState<TabId>("problem");
  const parts = ctx.file_path.split("/");
  const qualifier = [ctx.class_name, ctx.function_name ? `${ctx.function_name}()` : null].filter(Boolean).join(".");

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
      {/* file header */}
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap font-mono text-xs min-w-0">
          <FileCode size={13} className="text-indigo-400 flex-shrink-0" />
          <span className="text-slate-400">
            {parts.slice(0, -1).join("/")}
            {parts.length > 1 && "/"}
          </span>
          <span className="text-slate-100 font-semibold">{parts[parts.length - 1]}</span>
          {qualifier && <><span className="text-slate-600">·</span><span className="text-indigo-300">{qualifier}</span></>}
          {ctx.line_number != null && <><span className="text-slate-600">:</span><span className="text-yellow-400">{ctx.line_number}</span></>}
        </div>
        <span className="flex-shrink-0 px-2 py-0.5 text-xs font-mono bg-red-500/10 text-red-400 rounded border border-red-500/20">
          root cause
        </span>
      </div>

      {/* tabs */}
      <div className="flex border-b border-slate-700 bg-slate-900/30">
        {TABS.map(({ id, label, active }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              tab === id ? `${active} border-current` : "text-slate-500 hover:text-slate-300 border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* code */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Actions
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_STYLES: Record<string, { bar: string; badge: string; text: string; label: string }> = {
  immediate:  { bar: "bg-red-500",    badge: "bg-red-500/10 text-red-400 border-red-500/30",    text: "text-red-400",    label: "Immediate" },
  short_term: { bar: "bg-yellow-500", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", text: "text-yellow-400", label: "Short Term" },
  long_term:  { bar: "bg-blue-500",   badge: "bg-blue-500/10 text-blue-400 border-blue-500/30",   text: "text-blue-400",   label: "Long Term" },
};

function ActionsPanel({ actions }: { actions: RCA["recommended_actions"] }) {
  return (
    <div className="space-y-2.5">
      {actions.map((action, i) => {
        const s = ACTION_STYLES[action.priority] ?? ACTION_STYLES.long_term;
        return (
          <div key={i} className="flex gap-3 rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
            <div className={`w-1 flex-shrink-0 ${s.bar}`} />
            <div className="py-3 pr-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${s.badge}`}>
                  {s.label}
                </span>
              </div>
              <p className="text-sm text-slate-100 leading-snug">{action.action}</p>
              {action.rationale && (
                <p className="text-xs text-slate-500 mt-1 leading-snug">{action.rationale}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MTTR badge — time from triggered_at to generated_at
// ─────────────────────────────────────────────────────────────────────────────
function MttrBadge({ triggeredAt, generatedAt }: { triggeredAt: string; generatedAt: string }) {
  const diffMs = new Date(generatedAt).getTime() - new Date(triggeredAt).getTime();
  const mins = Math.round(diffMs / 60000);
  const label = mins < 1 ? "<1 min" : `${mins} min`;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs text-green-400 font-medium">
      <Zap size={11} />
      {label} MTTR
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  rca: RCA;
  triggeredAt: string;
  serviceName?: string | null;
}

export function RcaDetailView({ rca, triggeredAt, serviceName }: Props) {
  return (
    <div className="space-y-5">

      {/* ── Hero root cause card ───────────────────────────────────────── */}
      <div className="relative rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/50 overflow-hidden">
        {/* subtle left accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-red-500 via-orange-500 to-red-800" />

        <div className="px-6 pt-5 pb-4 ml-1">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Root Cause</span>
            </div>
            <ConfidenceMeter level={rca.confidence} />
          </div>

          <p className="text-lg font-medium text-slate-50 leading-snug mb-4">
            {rca.root_cause}
          </p>

          {/* meta chips */}
          <div className="flex flex-wrap gap-2">
            {serviceName && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-indigo-300 font-mono">
                {serviceName}
              </span>
            )}
            <MttrBadge triggeredAt={triggeredAt} generatedAt={rca.generated_at} />
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-400">
              <Code2 size={11} />
              {rca.model_used}
            </span>
            {rca.github_pr_url && (
              <a
                href={rca.github_pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-xs text-green-400 hover:bg-green-500/20 transition-colors"
              >
                <GitPullRequest size={11} />
                Fix PR #142
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Evidence rail ─────────────────────────────────────────────── */}
      {rca.evidence && rca.evidence.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2.5">
            Evidence
          </h3>
          <EvidenceRail evidence={rca.evidence} />
        </div>
      )}

      {/* ── Timeline + Code Context ────────────────────────────────────── */}
      <div className="grid grid-cols-[280px_1fr] gap-5 items-start">
        {/* Timeline */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Incident Timeline
          </h3>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <Timeline entries={rca.timeline} />
          </div>
        </div>

        {/* Code context */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Code Context
          </h3>
          {rca.code_context ? (
            <CodeContextCard ctx={rca.code_context} />
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500 italic">
              No specific code location identified.
            </div>
          )}
        </div>
      </div>

      {/* ── Recommended Actions ────────────────────────────────────────── */}
      {rca.recommended_actions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Recommended Actions
          </h3>
          <ActionsPanel actions={rca.recommended_actions} />
        </div>
      )}

      {/* ── PR CTA (if no url yet) ─────────────────────────────────────── */}
      {rca.needs_pr && !rca.github_pr_url && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700 bg-slate-800/30">
          <GitPullRequest size={15} className="text-slate-500" />
          <p className="text-sm text-slate-500">A fix PR was recommended but hasn't been created yet.</p>
        </div>
      )}
    </div>
  );
}
