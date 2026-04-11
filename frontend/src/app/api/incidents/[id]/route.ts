import { NextRequest, NextResponse } from "next/server";
import { MOCK_INCIDENTS } from "@/lib/mockData";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/incidents/${id}`,
      { next: { revalidate: 0 } }
    );
    if (res.ok) return NextResponse.json(await res.json());
  } catch {}

  const incident = MOCK_INCIDENTS.find((i) => i.id === id);
  if (!incident) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  return NextResponse.json(incident);
}
