const STEPS = ["Load Plan", "Reading", "Review"];

interface Props {
  step: number;
  onBack?: () => void;
}

export default function Header({ step, onBack }: Props) {
  return (
    <header className="bg-surface border-b border-border px-6 h-14 flex items-center gap-4 flex-shrink-0 shadow-sm">
      {/* Back button — only shown when a handler is provided (step 3) */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-[#1e293b]
            px-2.5 py-1.5 rounded-lg hover:bg-surface-2 transition-colors border border-transparent
            hover:border-border flex-shrink-0"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </button>
      )}

      <div className="flex items-center gap-2 font-bold text-accent text-[0.95rem]">
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6M9 12h6M9 15h4" />
        </svg>
        AsBuiltIQ
      </div>

      <div className="flex-1" />

      <nav className="flex items-center">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <div key={n} className="flex items-center">
              <div className="flex items-center gap-2 px-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all duration-300
                    ${
                      done
                        ? "bg-ok border-ok text-white"
                        : active
                          ? "bg-accent border-accent text-white"
                          : "bg-surface border-border text-muted"
                    }`}
                >
                  {done ? "✓" : n}
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap transition-colors
                    ${
                      done
                        ? "text-ok"
                        : active
                          ? "text-accent font-semibold"
                          : "text-muted"
                    }`}
                >
                  {label}
                </span>
              </div>
              {n < STEPS.length && (
                <div
                  className={`w-8 h-0.5 transition-colors duration-300 ${
                    done ? "bg-ok" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </nav>
    </header>
  );
}
