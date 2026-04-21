import { NextResponse } from "next/server";
import { MOCK_INCIDENTS } from "@/lib/mockData";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  try {
    const url = new URL(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/incidents`);
    if (status) url.searchParams.set("status", status);
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    const res = await fetch(url.toString(), {
      headers: apiKey ? { "X-API-Key": apiKey } : {},
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // fallback to mock
    let incidents = MOCK_INCIDENTS;
    if (status) incidents = incidents.filter((i) => i.status === status);
    return NextResponse.json(incidents);
  }
}
