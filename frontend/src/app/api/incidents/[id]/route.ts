import { NextRequest, NextResponse } from "next/server";
import { MOCK_INCIDENTS } from "@/lib/mockData";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const incident = MOCK_INCIDENTS.find((i) => i.id === params.id);
  if (!incident) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  return NextResponse.json(incident);
}
