const BASE = "/api/backend";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
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
      apiFetch<import("./types").Incident[]>(
        `/incidents${status ? `?status=${status}` : ""}`
      ),
    get: (id: string) =>
      apiFetch<import("./types").Incident>(`/incidents/${id}`),
  },
  topology: {
    get: () =>
      apiFetch<{ nodes: import("./types").TopologyNode[]; edges: import("./types").TopologyEdge[] }>(
        "/topology"
      ),
  },
};
