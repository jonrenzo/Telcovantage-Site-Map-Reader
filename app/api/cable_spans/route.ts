import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch("http://localhost:5000/api/cable_spans", {
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
