"use client";

import { useState, useEffect, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearHistory: () => void;
}

const STORAGE_KEY = "asbuilt-chat-history";
const MAX_MESSAGES = 100;

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load messages from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
    setIsHydrated(true);
  }, []);

  // Save messages to localStorage when they change
  useEffect(() => {
    if (!isHydrated) return;

    try {
      // Keep only the last MAX_MESSAGES
      const toSave = messages.slice(-MAX_MESSAGES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (err) {
      console.error("Failed to save chat history:", err);
    }
  }, [messages, isHydrated]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Create user message
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    // Add user message to state
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      // Get current messages for history (excluding the one we just added)
      const currentMessages = [...messages];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content.trim(),
          history: currentMessages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      // Add assistant message to state
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send message";
      setError(errorMessage);

      // Add error message as assistant response
      const errorAssistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorAssistantMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to clear chat history:", err);
    }
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearHistory,
  };
}
