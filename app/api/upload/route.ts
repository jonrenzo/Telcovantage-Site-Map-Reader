import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
  const response = await fetch(`${backendUrl}/api/upload`, {
    method: "POST",
    headers: {
      "content-type": contentType,
    },
    body: req.body,
    // @ts-expect-error - Node requires this to stream the body
    duplex: "half",
  });

  let data;
  try {
    data = await response.json();
  } catch {
    const text = await response.text();
    return NextResponse.json({ error: text || `Backend error: ${response.status}` }, { status: response.status });
  }
  return NextResponse.json(data, { status: response.status });
}
