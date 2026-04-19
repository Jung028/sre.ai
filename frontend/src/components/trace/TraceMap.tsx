"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import type { TraceData, TraceNode } from "@/lib/types";

const H_STEP = 200;
const V_STEP = 90;
const NODE_W = 140;
const NODE_H = 52;
const PAD_X = 20;
const PAD_Y = 20;

const NODE_TYPE_ICON: Record<string, string> = {
  service: "⬡",
  database: "🗄",
  cache: "⚡",
  queue: "📨",
  external: "🌐",
};

const STATUS_COLORS = {
  ok: { bg: "bg-[var(--bg-surface)]", border: "border-slate-600", text: "text-slate-200", dot: "bg-green-400" },
  error: { bg: "bg-red-950/60 dark:bg-red-950/60 bg-red-50", border: "border-red-500", text: "text-red-600 dark:text-red-200", dot: "bg-red-500" },
  slow: { bg: "bg-yellow-50 dark:bg-yellow-950/50", border: "border-yellow-500/70", text: "text-yellow-700 dark:text-yellow-200", dot: "bg-yellow-400" },
};

const EDGE_STATUS_COLOR = {
  ok: "#475569",
  error: "#ef4444",
  slow: "#eab308",
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

interface Props {
  trace: TraceData;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

export function TraceMap({ trace, selectedNodeId, onSelectNode }: Props) {
  const { positions, totalW, totalH } = useMemo(() => computeLayout(trace.nodes), [trace.nodes]);

  function cx(nodeId: string, side: "left" | "right") {
    const pos = positions[nodeId];
    return side === "right" ? pos.x + NODE_W : pos.x;
  }
  function cy(nodeId: string) {
    return positions[nodeId].y + NODE_H / 2;
  }

  return (
    <div className="relative overflow-auto" style={{ minHeight: totalH }}>
      {/* SVG edges layer */}
      <svg
        className="absolute inset-0 pointer-events-none"
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

          return (
            <g key={i}>
              <path
                d={path}
                stroke={color}
                strokeWidth={isDashed ? 2 : 1.5}
                fill="none"
                strokeDasharray={isDashed ? "6 3" : undefined}
                strokeOpacity={0.8}
                markerEnd={`url(#arrow-${edge.status})`}
                className={isDashed ? "animate-dash" : undefined}
              />
              {edge.label && (
                <text
                  x={(sx + dx) / 2}
                  y={(sy + dy) / 2 - 6}
                  fill={color}
                  fontSize={10}
                  textAnchor="middle"
                  opacity={0.75}
                >
                  {edge.label}
                </text>
              )}
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
            onClick={() => onSelectNode(isSelected ? null : node.id)}
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

      {/* Invisible spacer to set container size */}
      <div style={{ width: totalW, height: totalH }} />
    </div>
  );
}
