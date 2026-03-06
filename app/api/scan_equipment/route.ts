import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const response = await fetch("http://localhost:5000/api/scan_equipment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (e) {
        return NextResponse.json(
            { error: "Could not reach backend: " + (e as Error).message },
            { status: 502 }
        );
    }
}