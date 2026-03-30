"use client";

import { useState } from "react";
import { useChat } from "@/app/hooks/useChat";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const { messages, isLoading, sendMessage, clearHistory } = useChat();

  return (
    <>
      {/* Chat Window */}
      {isOpen && (
        <div
          className="fixed bottom-20 right-4 w-[380px] h-[500px] bg-gray-800 rounded-lg shadow-2xl 
                     flex flex-col z-50 border border-gray-700 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5 text-white"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97Z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium text-sm">AsBuilt IQ Assistant</h3>
                <p className="text-gray-400 text-xs">Powered by Gemini</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* Clear history button */}
              {messages.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm("Clear chat history?")) {
                      clearHistory();
                    }
                  }}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Clear history"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
              {/* Close button */}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                title="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <ChatMessages messages={messages} isLoading={isLoading} />

          {/* Input */}
          <ChatInput onSend={sendMessage} disabled={isLoading} />
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-4 right-4 w-14 h-14 rounded-full shadow-lg z-50
                   flex items-center justify-center transition-all duration-300
                   ${isOpen 
                     ? "bg-gray-700 hover:bg-gray-600" 
                     : "bg-blue-600 hover:bg-blue-700 hover:scale-110"
                   }`}
        title={isOpen ? "Close chat" : "Open chat assistant"}
      >
        {isOpen ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6 text-white"
          >
            <path
              fillRule="evenodd"
              d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6 text-white"
          >
            <path
              fillRule="evenodd"
              d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97Z"
              clipRule="evenodd"
            />
          </svg>
        )}
        
        {/* Notification dot for new users */}
        {!isOpen && messages.length === 0 && (
          <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
        )}
      </button>
    </>
  );
}
