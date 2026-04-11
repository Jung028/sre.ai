import { NextRequest, NextResponse } from "next/server";
import { MOCK_TOPOLOGY } from "@/lib/mockData";

export async function GET(req: NextRequest) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/topology`,
      { next: { revalidate: 0 } }
    );
    if (res.ok) return NextResponse.json(await res.json());
  } catch {}

  return NextResponse.json(MOCK_TOPOLOGY);
}
