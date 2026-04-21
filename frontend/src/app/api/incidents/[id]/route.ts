import { NextResponse } from "next/server";
import { MOCK_INCIDENTS } from "@/lib/mockData";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/incidents/${params.id}`,
      { headers: apiKey ? { "X-API-Key": apiKey } : {}, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return NextResponse.json(await res.json());
  } catch {
    const incident = MOCK_INCIDENTS.find((i) => i.id === params.id);
    if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(incident);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/incidents/${params.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-API-Key": apiKey } : {}),
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
