"use client";

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/app/hooks/useChat";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-2">💬</div>
          <p className="text-sm">Ask me anything about your CAD drawings!</p>
          <p className="text-xs mt-2 text-gray-500">
            Try: &quot;How many files are uploaded?&quot;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              message.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-100"
            }`}
          >
            {message.role === "user" ? (
              <div className="whitespace-pre-wrap break-words">
                {message.content}
              </div>
            ) : (
              <div className="chat-markdown break-words">
                <ReactMarkdown
                  components={{
                    // Style headings
                    h1: ({ children }) => (
                      <h1 className="text-base font-bold mb-2 mt-1">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-sm font-bold mb-1.5 mt-1">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-sm font-semibold mb-1 mt-1">{children}</h3>
                    ),
                    // Style paragraphs
                    p: ({ children }) => (
                      <p className="mb-2 last:mb-0">{children}</p>
                    ),
                    // Style lists
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="ml-1">{children}</li>
                    ),
                    // Style bold and emphasis
                    strong: ({ children }) => (
                      <strong className="font-semibold text-white">{children}</strong>
                    ),
                    em: ({ children }) => (
                      <em className="italic text-gray-200">{children}</em>
                    ),
                    // Style code
                    code: ({ children }) => (
                      <code className="bg-gray-800 px-1 py-0.5 rounded text-xs font-mono text-blue-300">
                        {children}
                      </code>
                    ),
                    // Style links
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        className="text-blue-400 hover:text-blue-300 underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
            <div
              className={`text-[10px] mt-1 ${
                message.role === "user" ? "text-blue-200" : "text-gray-400"
              }`}
            >
              {formatTime(message.timestamp)}
            </div>
          </div>
        </div>
      ))}

      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-gray-700 rounded-lg px-3 py-2">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
