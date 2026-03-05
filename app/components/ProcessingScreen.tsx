import type { PipelineStatus } from "../types";

interface Props {
    progress: number;
    total: number;
    status: PipelineStatus;
}

const STEPS = [
    { id: "extract", label: "Finding strand segments" },
    { id: "cluster", label: "Grouping into digit clusters" },
    { id: "infer",   label: "Reading the numbers" },
];

function getActiveStep(status: PipelineStatus, progress: number, total: number) {
    if (status !== "processing") return null;
    if (progress === 0) return "extract";
    if (progress > 0 && total > 0 && progress / total < 0.1) return "cluster";
    return "infer";
}

function getDoneSteps(status: PipelineStatus, progress: number, total: number) {
    const order = ["extract", "cluster", "infer"];
    if (status === "done") return new Set(order);
    const active = getActiveStep(status, progress, total);
    const ai = order.indexOf(active ?? "");
    return new Set(order.slice(0, ai));
}

export default function ProcessingScreen({ progress, total, status }: Props) {
    const pct      = total > 0 ? (progress / total) * 100 : 0;
    const active   = getActiveStep(status, progress, total);
    const doneSet  = getDoneSteps(status, progress, total);

    return (
        <main className="flex-1 flex items-center justify-center p-8 bg-[#f4f6fb]">
            <div className="bg-surface border border-border rounded-2xl p-10 max-w-sm w-full text-center shadow-sm">
                <div className="w-12 h-12 border-4 border-border border-t-accent rounded-full animate-spin-fast mx-auto mb-5" />

                <h2 className="text-lg font-bold mb-1.5">Reading your drawing…</h2>
                <p className="text-muted text-sm mb-6 leading-relaxed">
                    This may take a minute depending on the size of the drawing.
                </p>

                <div className="bg-surface-2 rounded-lg h-2.5 overflow-hidden mb-2">
                    <div
                        className="h-full bg-accent rounded-lg transition-all duration-500"
                        style={{ width: `${pct}%` }}
                    />
                </div>
                {total > 0 && (
                    <p className="text-xs text-muted mb-5">
                        {progress} of {total} readings
                    </p>
                )}

                <div className="flex flex-col gap-2 text-left mt-4">
                    {STEPS.map(({ id, label }) => {
                        const isDone   = doneSet.has(id);
                        const isActive = active === id;
                        return (
                            <div
                                key={id}
                                className={`flex items-center gap-2.5 text-sm transition-colors
                  ${isDone ? "text-ok"
                                    : isActive ? "text-accent font-medium"
                                        : "text-muted-2"}`}
                            >
                                <div
                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0
                    ${isDone ? "bg-ok text-white"
                                        : isActive ? "bg-accent text-white"
                                            : "bg-surface-2 text-muted-2"}`}
                                >
                                    {isDone ? "✓" : isActive ? "→" : "·"}
                                </div>
                                {label}
                            </div>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}