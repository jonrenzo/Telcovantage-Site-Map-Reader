import { NextRequest, NextResponse } from "next/server";
import { chat, generateMessageId, type ChatMessage } from "@/app/lib/chat/gemini";

export const runtime = "nodejs";
export const maxDuration = 60; // Allow up to 60 seconds for AI response

interface ChatRequest {
  message: string;
  history: ChatMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, history } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Check if API key is configured
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        {
          error: "Chat is not configured. Please add GOOGLE_GENERATIVE_AI_API_KEY to your environment variables.",
        },
        { status: 500 }
      );
    }

    // Call Gemini with the message and history
    const result = await chat(history || [], message);

    // Create the assistant message
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: result.response,
      timestamp: Date.now(),
    };

    return NextResponse.json({
      message: assistantMessage,
      toolCalls: result.toolCalls,
    });
  } catch (error) {
    console.error("Chat API error:", error);

    // Handle specific error types
    if (error instanceof Error) {
      // Check for API key errors
      if (error.message.includes("API_KEY")) {
        return NextResponse.json(
          { error: "Invalid API key. Please check your GOOGLE_GENERATIVE_AI_API_KEY." },
          { status: 401 }
        );
      }

      // Check for rate limiting
      if (error.message.includes("429") || error.message.includes("quota")) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again in a moment." },
          { status: 429 }
        );
      }

      // Check for network errors
      if (error.message.includes("fetch") || error.message.includes("network")) {
        return NextResponse.json(
          { error: "Network error. Please check your connection and try again." },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
