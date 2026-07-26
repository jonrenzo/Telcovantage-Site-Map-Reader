import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
    // Forward the query string — the viewer uses ?whole=true to ask for the
    // undivided strand and ?dxf_path= to name the drawing after a restart.
    const search = new URL(request.url).search;
    const response = await fetch(`${backendUrl}/api/cable_spans${search}`, {
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not reach backend: " + (e as Error).message },
      { status: 502 },
    );
  }
}
