"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import type { TraceData, TraceNode, TraceEdge } from "@/lib/types";
import { SpanLogPanel } from "./SpanLogPanel";

const H_STEP  = 220;
const V_STEP  = 100;
const NODE_W  = 148;
const NODE_H  = 56;
const PAD_X   = 40;
const PAD_Y   = 40;
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

const NODE_TYPE_ICON: Record<string, string> = {
  service:  "⬡",
  database: "🗄",
  cache:    "⚡",
  queue:    "📨",
  external: "🌐",
};

const STATUS_COLORS = {
  ok:    { bg: "bg-[var(--bg-surface)]",  border: "border-slate-600",     text: "text-slate-200", dot: "bg-green-400"  },
  error: { bg: "bg-red-950/60",            border: "border-red-500",       text: "text-red-200",   dot: "bg-red-500"    },
  slow:  { bg: "bg-yellow-950/50",         border: "border-yellow-500/70", text: "text-yellow-200",dot: "bg-yellow-400" },
};

const EDGE_STATUS_COLOR = { ok: "#475569", error: "#ef4444", slow: "#eab308" };

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
    const layerH     = (layerNodes.length - 1) * V_STEP + NODE_H;
    const layerTopY  = PAD_Y + (totalH - PAD_Y * 2 - layerH) / 2;
    positions[node.id] = {
      x: PAD_X + node.depth * H_STEP,
      y: layerTopY + node.indexInDepth * V_STEP,
    };
  }

  const totalW = PAD_X * 2 + (depths.length - 1) * H_STEP + NODE_W;
  return { positions, totalW, totalH };
}

// ─── Edge detail popup (fixed so it never clips) ─────────────────────────────
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
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0, position: "fixed" });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const POPUP_W = 320;
    const POPUP_H = ref.current.getBoundingClientRect().height || 300;
    const GAP = 14;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;

    let left = clientX - POPUP_W / 2;
    let top  = clientY - POPUP_H - GAP;
    if (top < 8)              top  = clientY + GAP;
    if (left < 8)             left = 8;
    if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8;
    if (top + POPUP_H > vh - 8)  top  = vh - POPUP_H - 8;

    setStyle({ position: "fixed", left, top, opacity: 1 });
  }, [clientX, clientY]);

  const statusColor =
    (edge.responseStatus ?? 0) >= 500 ? "text-red-400"
    : (edge.responseStatus ?? 0) >= 400 ? "text-yellow-400"
    : "text-green-400";

  const methodCls = HTTP_METHOD_COLORS[edge.method ?? ""] ?? "bg-slate-700 text-slate-300 border-slate-600";

  return (
    <div
      ref={ref}
      className="z-[100] w-80 bg-[#14141e] border border-slate-700 rounded-xl shadow-2xl shadow-black/70 overflow-hidden transition-opacity duration-100"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2">
          {edge.method && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${methodCls}`}>
              {edge.method}
            </span>
          )}
          <span className="text-xs text-slate-300 font-mono truncate max-w-[180px]">
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

      <div className="p-3 space-y-3 max-h-80 overflow-y-auto text-[11px]">
        <div className="flex gap-5">
          {edge.latencyMs !== undefined && (
            <div>
              <p className="text-slate-500 mb-0.5">Latency</p>
              <p className={`font-mono font-semibold ${
                edge.status === "error" ? "text-red-400" : edge.status === "slow" ? "text-yellow-400" : "text-green-400"
              }`}>
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

        {edge.responseBody && (
          <div>
            <p className="text-slate-500 mb-1 font-semibold uppercase tracking-wide text-[9px]">Response</p>
            <pre className={`bg-[var(--bg-deep)] rounded-lg p-2 border border-slate-800 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed ${
              (edge.responseStatus ?? 0) >= 400 ? "text-red-300" : "text-slate-300"
            }`}>
              {edge.responseBody}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Zoom controls ────────────────────────────────────────────────────────────
function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1">
      <button
        onClick={onZoomIn}
        className="w-8 h-8 flex items-center justify-center bg-slate-800/90 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors backdrop-blur-sm"
        title="Zoom in"
      >
        <Plus size={14} />
      </button>
      <button
        onClick={onZoomOut}
        className="w-8 h-8 flex items-center justify-center bg-slate-800/90 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors backdrop-blur-sm"
        title="Zoom out"
      >
        <Minus size={14} />
      </button>
      <button
        onClick={onReset}
        className="w-8 h-8 flex items-center justify-center bg-slate-800/90 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors backdrop-blur-sm"
        title="Reset view"
      >
        <RotateCcw size={12} />
      </button>
      <div className="text-center text-[9px] text-slate-600 font-mono">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props {
  trace: TraceData;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

interface Transform { x: number; y: number; scale: number }

export function TraceMap({ trace, selectedNodeId, onSelectNode }: Props) {
  const { positions, totalW, totalH } = useMemo(() => computeLayout(trace.nodes), [trace.nodes]);

  const [tf,              setTf]              = useState<Transform>({ x: 20, y: 20, scale: 1 });
  const [isDragging,      setIsDragging]      = useState(false);
  const [dragOrigin,      setDragOrigin]      = useState({ mx: 0, my: 0, tx: 0, ty: 0 });
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null);
  const [popupPos,        setPopupPos]        = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  // Center the graph initially
  useEffect(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const initScale = Math.min(1, (width - 80) / totalW, (height - 80) / totalH);
    const initX = (width  - totalW * initScale) / 2;
    const initY = (height - totalH * initScale) / 2;
    setTf({ x: initX, y: initY, scale: initScale });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ──
  function cx(nodeId: string, side: "left" | "right") {
    const p = positions[nodeId];
    return side === "right" ? p.x + NODE_W : p.x;
  }
  function cy(nodeId: string) { return positions[nodeId].y + NODE_H / 2; }

  /** Convert canvas-local coords → viewport client coords */
  function canvasToClient(cvX: number, cvY: number) {
    if (!containerRef.current) return { x: cvX, y: cvY };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: rect.left + cvX * tf.scale + tf.x,
      y: rect.top  + cvY * tf.scale + tf.y,
    };
  }

  // ── Wheel zoom ──
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, tf.scale * factor));
    setTf((prev) => ({
      scale: newScale,
      x: mx - (mx - prev.x) * (newScale / prev.scale),
      y: my - (my - prev.y) * (newScale / prev.scale),
    }));
  }

  // ── Pan ──
  function handleMouseDown(e: React.MouseEvent) {
    // Don't pan when clicking interactive elements
    const el = e.target as Element;
    if (el.closest("button") || el.closest("g.cursor-pointer")) return;
    e.preventDefault();
    setIsDragging(true);
    setDragOrigin({ mx: e.clientX, my: e.clientY, tx: tf.x, ty: tf.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setTf((prev) => ({
      ...prev,
      x: dragOrigin.tx + (e.clientX - dragOrigin.mx),
      y: dragOrigin.ty + (e.clientY - dragOrigin.my),
    }));
    // Move popup with pan if visible
    if (selectedEdgeIdx !== null) {
      setPopupPos((prev) => ({
        x: prev.x + (e.clientX - dragOrigin.mx) - (tf.x - dragOrigin.tx),
        y: prev.y + (e.clientY - dragOrigin.my) - (tf.y - dragOrigin.ty),
      }));
    }
  }

  function handleMouseUp() { setIsDragging(false); }

  function resetView() {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const s = Math.min(1, (width - 80) / totalW, (height - 80) / totalH);
    setTf({ x: (width - totalW * s) / 2, y: (height - totalH * s) / 2, scale: s });
    setSelectedEdgeIdx(null);
  }

  // ── Selected edge ──
  const selectedEdge = selectedEdgeIdx !== null ? trace.edges[selectedEdgeIdx] : null;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative select-none"
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => setSelectedEdgeIdx(null)}
    >
      {/* ── Transformed canvas ── */}
      <div
        className="absolute"
        style={{
          transform: `translate(${tf.x}px,${tf.y}px) scale(${tf.scale})`,
          transformOrigin: "0 0",
          width: totalW,
          height: totalH,
        }}
      >
        {/* SVG edge layer */}
        <svg
          className="absolute inset-0"
          width={totalW}
          height={totalH}
          style={{ overflow: "visible" }}
        >
          <defs>
            {(["ok", "error", "slow"] as const).map((s) => (
              <marker key={s} id={`arrow-${s}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill={EDGE_STATUS_COLOR[s]} opacity="0.85" />
              </marker>
            ))}
          </defs>

          {trace.edges.map((edge, i) => {
            const sx  = cx(edge.source, "right");
            const sy  = cy(edge.source);
            const dx  = cx(edge.target, "left");
            const dy  = cy(edge.target);
            const cp  = H_STEP * 0.45;
            const d   = `M ${sx} ${sy} C ${sx + cp} ${sy} ${dx - cp} ${dy} ${dx} ${dy}`;
            const col = EDGE_STATUS_COLOR[edge.status];
            const isDash   = edge.status === "error";
            const isSel    = selectedEdgeIdx === i;
            const midX = (sx + dx) / 2;
            const midY = (sy + dy) / 2;

            return (
              <g
                key={i}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSel) {
                    setSelectedEdgeIdx(null);
                  } else {
                    const client = canvasToClient(midX, midY);
                    setPopupPos({ x: client.x, y: client.y });
                    setSelectedEdgeIdx(i);
                    onSelectNode(null);
                  }
                }}
              >
                {/* Wide invisible hit zone */}
                <path d={d} stroke="transparent" strokeWidth={20} fill="none" />
                {/* Visible path */}
                <path
                  d={d}
                  stroke={isSel ? "#818cf8" : col}
                  strokeWidth={isSel ? 2.5 : isDash ? 2 : 1.5}
                  fill="none"
                  strokeDasharray={isDash ? "6 3" : undefined}
                  strokeOpacity={isSel ? 1 : 0.8}
                  markerEnd={`url(#arrow-${edge.status})`}
                />
                {edge.label && (
                  <text
                    x={midX} y={midY - 8}
                    fill={isSel ? "#818cf8" : col}
                    fontSize={10} textAnchor="middle"
                    opacity={isSel ? 1 : 0.75}
                    className="pointer-events-none select-none"
                  >
                    {edge.label}
                  </text>
                )}
                <circle
                  cx={midX} cy={midY}
                  r={isSel ? 5 : 3.5}
                  fill={isSel ? "#818cf8" : col}
                  opacity={isSel ? 1 : 0.55}
                />
              </g>
            );
          })}
        </svg>

        {/* Node cards */}
        {trace.nodes.map((node) => {
          const pos    = positions[node.id];
          const style  = STATUS_COLORS[node.status];
          const isSel  = selectedNodeId === node.id;

          return (
            <button
              key={node.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedEdgeIdx(null);
                onSelectNode(isSel ? null : node.id);
              }}
              className={`absolute border rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer ${style.bg} ${style.border} ${style.text} ${
                isSel ? "ring-2 ring-indigo-400 scale-105 shadow-lg shadow-indigo-500/20 z-10" : "hover:scale-[1.03] hover:z-10"
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

        {/* Spacer */}
        <div style={{ width: totalW, height: totalH }} />
      </div>

      {/* ── Zoom controls ── */}
      <ZoomControls
        scale={tf.scale}
        onZoomIn={() => setTf((p) => {
          const s = Math.min(MAX_SCALE, p.scale * 1.2);
          const cx2 = containerRef.current ? containerRef.current.offsetWidth / 2 : 0;
          const cy2 = containerRef.current ? containerRef.current.offsetHeight / 2 : 0;
          return { scale: s, x: cx2 - (cx2 - p.x) * (s / p.scale), y: cy2 - (cy2 - p.y) * (s / p.scale) };
        })}
        onZoomOut={() => setTf((p) => {
          const s = Math.max(MIN_SCALE, p.scale * 0.8);
          const cx2 = containerRef.current ? containerRef.current.offsetWidth / 2 : 0;
          const cy2 = containerRef.current ? containerRef.current.offsetHeight / 2 : 0;
          return { scale: s, x: cx2 - (cx2 - p.x) * (s / p.scale), y: cy2 - (cy2 - p.y) * (s / p.scale) };
        })}
        onReset={resetView}
      />

      {/* ── Hint ── */}
      {!selectedNodeId && selectedEdgeIdx === null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <p className="text-[11px] text-slate-600 bg-[var(--bg-surface)]/80 border border-slate-800 rounded-full px-3 py-1 backdrop-blur-sm whitespace-nowrap">
            Drag to pan · Scroll to zoom · Click node or arrow for details
          </p>
        </div>
      )}

      {/* ── Edge popup (fixed, never clips) ── */}
      {selectedEdge && (
        <EdgePopup
          edge={selectedEdge}
          clientX={popupPos.x}
          clientY={popupPos.y}
          onClose={() => setSelectedEdgeIdx(null)}
        />
      )}

      {/* ── Node log overlay — floats inside the map on the right ── */}
      {selectedNodeId && (
        <div
          className="absolute top-4 right-4 bottom-4 z-30 flex flex-col bg-[#0f0f18]/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
          style={{ width: "clamp(300px, 32%, 420px)" }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="p-4 flex-1 overflow-hidden flex flex-col">
            <SpanLogPanel
              trace={trace}
              selectedNodeId={selectedNodeId}
              onClose={() => onSelectNode(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
