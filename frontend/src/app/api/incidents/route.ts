import { NextRequest, NextResponse } from "next/server";
import { MOCK_INCIDENTS } from "@/lib/mockData";

// Try real backend first, fall back to mock data
async function fetchFromBackend(url: string) {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (res.ok) return res.json();
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const backendUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/incidents${status ? `?status=${status}` : ""}`;
  const data = await fetchFromBackend(backendUrl);
  if (data) return NextResponse.json(data);

  // Mock fallback
  let incidents = MOCK_INCIDENTS;
  if (status && status !== "all") {
    incidents = incidents.filter((i) => i.status === status);
  }
  return NextResponse.json(incidents);
}
