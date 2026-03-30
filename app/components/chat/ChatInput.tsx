"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput("");
      // Reset height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-gray-700 p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Ask about your CAD drawings..."}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-gray-700 text-white text-sm rounded-lg px-3 py-2 
                     placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed
                     scrollbar-thin scrollbar-thumb-gray-600"
          style={{ minHeight: "38px", maxHeight: "120px" }}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || disabled}
          className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors duration-200"
          title="Send message"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
          </svg>
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mt-1 text-center">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
