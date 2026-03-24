"use client"

interface Props {
  localUpdatedAt: string
  serverUpdatedAt: string
  onKeepMine: () => void
  onUseServer: () => void
  onMergeBoth: () => void
  onDismiss: () => void
}

export default function ConflictModal({ localUpdatedAt, serverUpdatedAt, onKeepMine, onUseServer, onMergeBoth, onDismiss }: Props) {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
      " " + date.toLocaleDateString()
  }

  const getTimeDiff = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins} min ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`
    return formatTime(dateStr)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] overflow-hidden">
        <div className="p-6 border-b border-border bg-review-light">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-review flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-[#1e293b] text-lg">Conflict Detected</h3>
              <p className="text-sm text-muted">Your changes may conflict with another tab</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2">
              <div>
                <p className="text-xs text-muted uppercase tracking-wider font-semibold">Your Version</p>
                <p className="text-sm font-medium mt-1">Saved {getTimeDiff(localUpdatedAt)}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2">
              <div>
                <p className="text-xs text-muted uppercase tracking-wider font-semibold">Server Version</p>
                <p className="text-sm font-medium mt-1">Saved {getTimeDiff(serverUpdatedAt)}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-ok/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7" />
                  <ellipse cx="12" cy="7" rx="8" ry="4" />
                </svg>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted mb-4">
            Another tab modified this session. Choose how to resolve:
          </p>

          <div className="space-y-2">
            <button
              onClick={onKeepMine}
              className="w-full text-left p-4 rounded-xl border border-border hover:border-accent hover:bg-accent-light transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-[#1e293b]">Keep Mine</p>
                  <p className="text-xs text-muted">Overwrite with your local changes</p>
                </div>
              </div>
            </button>

            <button
              onClick={onUseServer}
              className="w-full text-left p-4 rounded-xl border border-border hover:border-ok hover:bg-ok-light transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-ok/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7" />
                    <ellipse cx="12" cy="7" rx="8" ry="4" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-[#1e293b]">Use Server Version</p>
                  <p className="text-xs text-muted">Discard your changes and load from database</p>
                </div>
              </div>
            </button>

            <button
              onClick={onMergeBoth}
              className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500 hover:bg-purple-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="18" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <path d="M6 21V9a9 9 0 0 0 9 9" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-[#1e293b]">Merge Both</p>
                  <p className="text-xs text-muted">Combine non-conflicting changes (recommended)</p>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="px-6 py-4 bg-surface-2 border-t border-border">
          <button
            onClick={onDismiss}
            className="w-full py-2 text-sm text-muted hover:text-[#1e293b] transition-colors"
          >
            Cancel — keep editing locally
          </button>
        </div>
      </div>
    </div>
  )
}
