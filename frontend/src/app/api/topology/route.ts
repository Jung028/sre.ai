import { NextResponse } from "next/server";
import { MOCK_TOPOLOGY } from "@/lib/mockData";

export async function GET() {
  return NextResponse.json(MOCK_TOPOLOGY);
}
