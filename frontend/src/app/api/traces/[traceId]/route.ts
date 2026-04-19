import { NextResponse } from "next/server";
import { MOCK_TRACES } from "@/lib/traceData";

export async function GET(
  _req: Request,
  { params }: { params: { traceId: string } }
) {
  const { traceId } = params;

  // Try real backend first
  try {
    const res = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:8000"}/traces/${traceId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      return NextResponse.json(await res.json());
    }
  } catch {
    // Fall through to mock
  }

  const trace = MOCK_TRACES[traceId];
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  return NextResponse.json(trace);
}
