// API client utility — hits Next.js internal routes which proxy to backend with mock fallback
const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(process.env.NEXT_PUBLIC_API_KEY ? { "X-API-Key": process.env.NEXT_PUBLIC_API_KEY } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// Internal Next.js API routes — try real backend, fall back to mock data automatically
const BASE = "/api";

async function internalFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export const api = {
  incidents: {
    list: (status?: string) =>
      internalFetch<import("./types").Incident[]>(
        `/incidents${status && status !== "all" ? `?status=${status}` : ""}`
      ),
    get: (id: string) =>
      internalFetch<import("./types").Incident>(`/incidents/${id}`),
  },
  topology: {
    get: () =>
      internalFetch<{ nodes: import("./types").TopologyNode[]; edges: import("./types").TopologyEdge[] }>(
        "/topology"
      ),
  },
};
