const STEPS = ["Load Drawing", "Reading", "Review", "Export"];

interface Props {
    step: number;
}

export default function Header({ step }: Props) {
    return (
        <header className="bg-surface border-b border-border px-6 h-14 flex items-center gap-4 flex-shrink-0 shadow-sm">
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
                Strand Line and Equipment Identifier
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
                    ${done ? "bg-ok border-ok text-white"
                                        : active ? "bg-accent border-accent text-white"
                                            : "bg-surface border-border text-muted"}`}
                                >
                                    {done ? "✓" : n}
                                </div>
                                <span
                                    className={`text-xs font-medium whitespace-nowrap transition-colors
                    ${done ? "text-ok"
                                        : active ? "text-accent font-semibold"
                                            : "text-muted"}`}
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