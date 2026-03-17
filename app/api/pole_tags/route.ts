import { NextResponse } from "next/server";

export async function GET() {
    try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
        const res = await fetch(`${backendUrl}/api/pole_tags`, {
            cache: "no-store",
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (err) {
        return NextResponse.json(
            { error: "Flask unreachable: " + String(err) },
            { status: 502 }
        );
    }
}