import { NextRequest, NextResponse } from "next/server";
import { MOCK_INCIDENTS } from "@/lib/mockData";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  let incidents = MOCK_INCIDENTS;
  if (status && status !== "all") {
    incidents = incidents.filter((i) => i.status === status);
  }
  return NextResponse.json(incidents);
}
