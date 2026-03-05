import { NextRequest, NextResponse } from "next/server";

export const config = {
    api: {
        bodyParser: false,
    },
};

export async function POST(req: NextRequest) {
    const contentType = req.headers.get("content-type") ?? "";

    const response = await fetch("http://localhost:5000/api/upload", {
        method: "POST",
        headers: {
            "content-type": contentType,
        },
        body: req.body,
        // @ts-expect-error - Node requires this to stream the body
        duplex: "half",
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
}