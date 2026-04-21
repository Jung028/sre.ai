"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import type { TraceData, TraceNode, TraceEdge } from "@/lib/types";

const H_STEP = 220;
const V_STEP = 100;
const NODE_W = 148;
const NODE_H = 56;
const PAD_X = 28;
const PAD_Y = 32;

const NODE_TYPE_ICON: Record<string, string> = {
  service: "⬡",
  database: "🗄",
  cache: "⚡",
  queue: "📨",
  external: "🌐",
};

const STATUS_COLORS = {
  ok:    { bg: "bg-[var(--bg-surface)]",   border: "border-slate-600",      text: "text-slate-200",       dot: "bg-green-400"  },
  error: { bg: "bg-red-950/60",             border: "border-red-500",        text: "text-red-200",         dot: "bg-red-500"    },
  slow:  { bg: "bg-yellow-950/50",          border: "border-yellow-500/70",  text: "text-yellow-200",      dot: "bg-yellow-400" },
};

const EDGE_STATUS_COLOR = {
  ok:    "#475569",
  error: "#ef4444",
  slow:  "#eab308",
};

const HTTP_METHOD_COLORS: Record<string, string> = {
  GET:    "bg-blue-500/20 text-blue-300 border-blue-500/40",
  POST:   "bg-green-500/20 text-green-300 border-green-500/40",
  PUT:    "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  PATCH:  "bg-orange-500/20 text-orange-300 border-orange-500/40",
  DELETE: "bg-red-500/20 text-red-300 border-red-500/40",
  SQL:    "bg-purple-500/20 text-purple-300 border-purple-500/40",
  SQS:    "bg-pink-500/20 text-pink-300 border-pink-500/40",
  RPC:    "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  SET:    "bg-teal-500/20 text-teal-300 border-teal-500/40",
};

function computeLayout(nodes: TraceNode[]) {
  const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const maxInDepth = Math.max(...depths.map((d) => nodes.filter((n) => n.depth === d).length));
  const totalH = (maxInDepth - 1) * V_STEP + NODE_H + PAD_Y * 2;

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const layerNodes = nodes.filter((n) => n.depth === node.depth);
    const layerH = (layerNodes.length - 1) * V_STEP + NODE_H;
    const layerTopY = PAD_Y + (totalH - PAD_Y * 2 - layerH) / 2;
    positions[node.id] = {
      x: PAD_X + node.depth * H_STEP,
      y: layerTopY + node.indexInDepth * V_STEP,
    };
  }

  const totalW = PAD_X * 2 + (depths.length - 1) * H_STEP + NODE_W;
  return { positions, totalW, totalH };
}

// ─── Edge detail popup (fixed-positioned so it never clips) ──────────────────
function EdgePopup({
  edge,
  clientX,
  clientY,
  onClose,
}: {
  edge: TraceEdge;
  clientX: number;
  clientY: number;
  onClose: () => void;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const POPUP_W = 320;
    const POPUP_H = rect.height || 280;
    const GAP = 12;

    let left = clientX - POPUP_W / 2;
    let top  = clientY - POPUP_H - GAP;

    // Flip below if not enough room above
    if (top < 8) top = clientY + GAP;
    // Clamp horizontally
    if (left < 8) left = 8;
    if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8;
    // Clamp vertically
    if (top + POPUP_H > vh - 8) top = vh - POPUP_H - 8;

    setStyle({ position: "fixed", left, top, opacity: 1 });
  }, [clientX, clientY]);

  const statusColor =
    edge.responseStatus && edge.responseStatus >= 500
      ? "text-red-400"
      : edge.responseStatus && edge.responseStatus >= 400
      ? "text-yellow-400"
      : "text-green-400";

  const methodCls = HTTP_METHOD_COLORS[edge.method ?? ""] ?? "bg-slate-700 text-slate-300 border-slate-600";

  return (
    <div
      ref={ref}
      className="z-50 w-80 bg-[#14141e] border border-slate-700 rounded-xl shadow-2xl shadow-black/60 overflow-hidden transition-opacity duration-100"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2">
          {edge.method && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${methodCls}`}>
              {edge.method}
            </span>
          )}
          <span className="text-xs text-slate-300 font-mono truncate max-w-[160px]">
            {edge.label ?? `${edge.source} → ${edge.target}`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 text-slate-500 hover:text-white transition-colors rounded"
        >
          <X size={13} />
        </button>
      </div>

      <div className="p-3 space-y-3 max-h-72 overflow-y-auto text-[11px]">
        {/* Latency + status */}
        <div className="flex gap-4">
          {edge.latencyMs !== undefined && (
            <div>
              <p className="text-slate-500 mb-0.5">Latency</p>
              <p className={`font-mono font-semibold ${edge.status === "error" ? "text-red-400" : edge.status === "slow" ? "text-yellow-400" : "text-green-400"}`}>
                {edge.latencyMs >= 1000 ? `${(edge.latencyMs / 1000).toFixed(2)}s` : `${edge.latencyMs}ms`}
              </p>
            </div>
          )}
          {edge.responseStatus !== undefined && (
            <div>
              <p className="text-slate-500 mb-0.5">Status</p>
              <p className={`font-mono font-bold ${statusColor}`}>{edge.responseStatus}</p>
            </div>
          )}
        </div>

        {/* Headers */}
        {edge.headers && Object.keys(edge.headers).length > 0 && (
          <div>
            <p className="text-slate-500 mb-1 font-semibold uppercase tracking-wide text-[9px]">Request Headers</p>
            <div className="bg-[var(--bg-deep)] rounded-lg p-2 space-y-0.5 border border-slate-800">
              {Object.entries(edge.headers).map(([k, v]) => (
                <div key={k} className="flex gap-2 font-mono">
                  <span className="text-indigo-400 flex-shrink-0">{k}:</span>
                  <span className="text-slate-400 truncate">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Params */}
        {edge.requestParams && Object.keys(edge.requestParams).length > 0 && (
          <div>
            <p className="text-slate-500 mb-1 font-semibold uppercase tracking-wide text-[9px]">
              {edge.method === "SQL" ? "Query Params" : "Request Params"}
            </p>
            <div className="bg-[var(--bg-deep)] rounded-lg p-2 space-y-0.5 border border-slate-800">
              {Object.entries(edge.requestParams).map(([k, v]) => (
                <div key={k} className="flex gap-2 font-mono">
                  <span className="text-yellow-400/80 flex-shrink-0">{k}:</span>
                  <span className="text-slate-400 break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request body */}
        {edge.requestBody && (
          <div>
            <p className="text-slate-500 mb-1 font-semibold uppercase tracking-wide text-[9px]">
              {edge.method === "SQL" ? "Query" : "Request Body"}
            </p>
            <pre className="bg-[var(--bg-deep)] rounded-lg p-2 border border-slate-800 text-slate-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {edge.requestBody}
            </pre>
          </div>
        )}

        {/* Response */}
        {edge.responseBody && (
          <div>
            <p className="text-slate-500 mb-1 font-semibold uppercase tracking-wide text-[9px]">Response</p>
            <pre className={`bg-[var(--bg-deep)] rounded-lg p-2 border border-slate-800 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed ${
              edge.responseStatus && edge.responseStatus >= 400 ? "text-red-300" : "text-slate-300"
            }`}>
              {edge.responseBody}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  trace: TraceData;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

export function TraceMap({ trace, selectedNodeId, onSelectNode }: Props) {
  const { positions, totalW, totalH } = useMemo(() => computeLayout(trace.nodes), [trace.nodes]);
  const [selectedEdgeIdx,  setSelectedEdgeIdx]  = useState<number | null>(null);
  const [popupClientPos,   setPopupClientPos]    = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  function cx(nodeId: string, side: "left" | "right") {
    const pos = positions[nodeId];
    return side === "right" ? pos.x + NODE_W : pos.x;
  }
  function cy(nodeId: string) {
    return positions[nodeId].y + NODE_H / 2;
  }

  // Converts SVG local coords → viewport client coords
  function svgToClient(svgX: number, svgY: number) {
    if (!svgRef.current) return { x: svgX, y: svgY };
    const rect = svgRef.current.getBoundingClientRect();
    const svgW = svgRef.current.viewBox?.baseVal.width || totalW;
    const svgH = svgRef.current.viewBox?.baseVal.height || totalH;
    const scaleX = svgW > 0 ? rect.width  / svgW : 1;
    const scaleY = svgH > 0 ? rect.height / svgH : 1;
    return {
      x: rect.left + svgX * scaleX,
      y: rect.top  + svgY * scaleY,
    };
  }

  function handleMapClick() {
    setSelectedEdgeIdx(null);
  }

  const selectedEdge = selectedEdgeIdx !== null ? trace.edges[selectedEdgeIdx] : null;

  return (
    <div className="relative overflow-auto" style={{ minHeight: totalH }} onClick={handleMapClick}>
      {/* SVG edges layer — pointer-events enabled for click */}
      <svg
        ref={svgRef}
        className="absolute inset-0"
        width={totalW}
        height={totalH}
        style={{ overflow: "visible" }}
      >
        <defs>
          {(["ok", "error", "slow"] as const).map((s) => (
            <marker
              key={s}
              id={`arrow-${s}`}
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill={EDGE_STATUS_COLOR[s]} opacity="0.85" />
            </marker>
          ))}
        </defs>
        {trace.edges.map((edge, i) => {
          const sx = cx(edge.source, "right");
          const sy = cy(edge.source);
          const dx = cx(edge.target, "left");
          const dy = cy(edge.target);
          const cp = H_STEP * 0.45;
          const path = `M ${sx} ${sy} C ${sx + cp} ${sy} ${dx - cp} ${dy} ${dx} ${dy}`;
          const color = EDGE_STATUS_COLOR[edge.status];
          const isDashed = edge.status === "error";
          const isSelected = selectedEdgeIdx === i;
          const midX = (sx + dx) / 2;
          const midY = (sy + dy) / 2;

          return (
            <g
              key={i}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                if (isSelected) {
                  setSelectedEdgeIdx(null);
                } else {
                  const client = svgToClient(midX, midY);
                  setPopupClientPos({ x: client.x, y: client.y });
                  setSelectedEdgeIdx(i);
                  onSelectNode(null);
                }
              }}
            >
              {/* Invisible wide hit target */}
              <path
                d={path}
                stroke="transparent"
                strokeWidth={20}
                fill="none"
              />
              {/* Visible path */}
              <path
                d={path}
                stroke={isSelected ? "#818cf8" : color}
                strokeWidth={isSelected ? 2.5 : isDashed ? 2 : 1.5}
                fill="none"
                strokeDasharray={isDashed ? "6 3" : undefined}
                strokeOpacity={isSelected ? 1 : 0.8}
                markerEnd={`url(#arrow-${edge.status})`}
                className={isDashed ? "animate-dash" : undefined}
              />
              {/* Label */}
              {edge.label && (
                <text
                  x={midX}
                  y={midY - 8}
                  fill={isSelected ? "#818cf8" : color}
                  fontSize={10}
                  textAnchor="middle"
                  opacity={isSelected ? 1 : 0.75}
                  className="select-none pointer-events-none"
                >
                  {edge.label}
                </text>
              )}
              {/* Clickable dot indicator at midpoint */}
              <circle
                cx={midX}
                cy={midY}
                r={isSelected ? 5 : 3.5}
                fill={isSelected ? "#818cf8" : color}
                opacity={isSelected ? 1 : 0.6}
                className="transition-all"
              />
            </g>
          );
        })}
      </svg>

      {/* Node cards */}
      {trace.nodes.map((node) => {
        const pos = positions[node.id];
        const style = STATUS_COLORS[node.status];
        const isSelected = selectedNodeId === node.id;

        return (
          <button
            key={node.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedEdgeIdx(null);
              onSelectNode(isSelected ? null : node.id);
            }}
            className={`absolute border rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer ${style.bg} ${style.border} ${style.text} ${
              isSelected ? "ring-2 ring-indigo-400 scale-105 shadow-lg shadow-indigo-500/20 z-10" : "hover:scale-[1.03] hover:z-10"
            }`}
            style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
              <span className="text-xs font-semibold truncate">{node.label}</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] opacity-60">
              <span>{NODE_TYPE_ICON[node.type] ?? "•"}</span>
              <span className="capitalize">{node.type}</span>
              {node.status !== "ok" && (
                <span className={`ml-auto font-bold uppercase ${node.status === "error" ? "text-red-400" : "text-yellow-400"}`}>
                  {node.status}
                </span>
              )}
            </div>
          </button>
        );
      })}

      {/* Edge popup — rendered fixed so it never clips */}
      {selectedEdge && (
        <EdgePopup
          edge={selectedEdge}
          clientX={popupClientPos.x}
          clientY={popupClientPos.y}
          onClose={() => setSelectedEdgeIdx(null)}
        />
      )}

      {/* Invisible spacer to set container size */}
      <div style={{ width: totalW, height: totalH }} />
    </div>
  );
}
