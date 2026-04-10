"use client";

import { useEffect, useState } from "react";
import type { StreamEvent } from "./types";

export type StreamStatus = "connecting" | "streaming" | "done" | "error" | "idle";

export function useIncidentStream(incidentId: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [rca, setRca] = useState<string | null>(null);
  const [status, setStatus] = useState<StreamStatus>("idle");

  useEffect(() => {
    if (!incidentId) return;

    setStatus("connecting");
    setEvents([]);
    setRca(null);

    const es = new EventSource(`/api/backend/incidents/${incidentId}/stream`);

    es.onopen = () => setStatus("streaming");

    es.onmessage = (e) => {
      try {
        const event: StreamEvent = JSON.parse(e.data);
        setEvents((prev) => [...prev, event]);

        if (event.type === "result") {
          setRca((event.data as { text: string }).text ?? null);
          setStatus("done");
          es.close();
        } else if (event.type === "error") {
          setStatus("error");
          es.close();
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setStatus("error");
      es.close();
    };

    return () => es.close();
  }, [incidentId]);

  return { events, rca, status };
}
