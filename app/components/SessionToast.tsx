"use client"

import { useEffect, useState } from "react"

interface Props {
  fileName: string
  lastSaved: string
  onResume: () => void
  onStartFresh: () => void
  onDismiss: () => void
}

export default function SessionToast({ fileName, lastSaved, onResume, onStartFresh, onDismiss }: Props) {
  const [countdown, setCountdown] = useState(10)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onDismiss()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [onDismiss])

  const formatLastSaved = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)

    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 bg-white rounded-2xl shadow-2xl border border-border overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-accent"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7" />
              <ellipse cx="12" cy="7" rx="8" ry="4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-[#1e293b] mb-1">Resume Previous Session?</h3>
            <p className="text-sm text-muted">
              Found saved work for <span className="font-medium text-[#1e293b]">"{fileName}"</span>
            </p>
            <p className="text-xs text-muted mt-1">
              Last saved {formatLastSaved(lastSaved)}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onResume}
            className="flex-1 py-2.5 px-4 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            Resume Session ✓
          </button>
          <button
            onClick={onStartFresh}
            className="flex-1 py-2.5 px-4 bg-surface-2 text-[#1e293b] text-sm font-semibold rounded-xl border border-border hover:bg-surface transition-colors"
          >
            Start Fresh ↻
          </button>
        </div>

        <p className="text-xs text-muted text-center mt-3">
          Auto-resuming in {countdown}s...{" "}
          <button onClick={onDismiss} className="text-accent hover:underline">
            Cancel
          </button>
        </p>
      </div>
    </div>
  )
}
