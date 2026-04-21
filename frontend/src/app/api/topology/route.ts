import { NextResponse } from "next/server";

const MOCK_TOPOLOGY = {
  nodes: [
    { id: "api-gateway", label: "API Gateway", incident_count: 2, severity: "high", status: "warning" },
    { id: "auth-service", label: "Auth Service", incident_count: 0, severity: "low", status: "healthy" },
    { id: "order-service", label: "Order Service", incident_count: 1, severity: "critical", status: "warning" },
    { id: "payment-service", label: "Payment Service", incident_count: 3, severity: "critical", status: "warning" },
    { id: "postgres", label: "PostgreSQL", incident_count: 0, severity: "low", status: "healthy" },
    { id: "redis-cache", label: "Redis Cache", incident_count: 1, severity: "medium", status: "warning" },
  ],
  edges: [
    { source: "api-gateway", target: "auth-service", label: "" },
    { source: "api-gateway", target: "order-service", label: "" },
    { source: "order-service", target: "payment-service", label: "" },
    { source: "order-service", target: "postgres", label: "" },
    { source: "auth-service", target: "redis-cache", label: "" },
  ],
};

export async function GET() {
  try {
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/topology`,
      { headers: apiKey ? { "X-API-Key": apiKey } : {}, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(MOCK_TOPOLOGY);
  }
}
