import { NextResponse } from "next/server";
import { MOCK_TRACES } from "@/lib/traceData";

export async function GET(
  _req: Request,
  { params }: { params: { traceId: string } }
) {
  const trace = MOCK_TRACES[params.traceId];
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  return NextResponse.json(trace);
}
