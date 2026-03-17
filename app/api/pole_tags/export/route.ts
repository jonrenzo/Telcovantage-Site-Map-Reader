import { NextResponse } from "next/server";

export async function POST() {
  try {
    const res = await fetch("http://localhost:5000/api/pole_tags/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: "Flask unreachable: " + String(err) },
      { status: 502 },
    );
  }
}
