import type { PipelineStatus } from "../types";

interface Props {
  progress: number;
  total: number;
  status: PipelineStatus;
}

const STEPS = [
  { id: "extract", label: "Finding strand segments" },
  { id: "cluster", label: "Grouping into digit clusters" },
  { id: "infer", label: "Reading the numbers" },
];

function getActiveStep(
  status: PipelineStatus,
  progress: number,
  total: number,
) {
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
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  const active = getActiveStep(status, progress, total);
  const doneSet = getDoneSteps(status, progress, total);

  return (
    <main className="flex-1 flex items-center justify-center p-8 bg-[#f4f6fb]">
      <div className="bg-white border border-gray-100 rounded-2xl p-10 max-w-sm w-full text-center shadow-sm animate-fade-slide-in">
        {/* Animated icon with pulse rings */}
        <div className="relative w-16 h-16 mx-auto mb-7">
          <div className="absolute inset-0 rounded-full border-2 border-blue-400 animate-pulse-ring" />
          <div className="absolute inset-1 rounded-full border-2 border-blue-200 animate-pulse-ring [animation-delay:400ms]" />
          <div className="absolute inset-3 rounded-full bg-blue-50 flex items-center justify-center">
            <svg
              className="w-[18px] h-[18px] animate-spin text-blue-700"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
        </div>

        <h2 className="text-base font-medium text-gray-900 mb-1.5">
          Reading your drawing
        </h2>
        <p className="text-sm text-gray-400 mb-7 leading-relaxed">
          This may take a minute depending on the size of the file.
        </p>

        {/* Progress bar */}
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-gray-400">Processing</span>
          <span className="text-xs font-medium text-gray-700">{pct}%</span>
        </div>
        <div className="bg-gray-100 rounded-full h-[5px] overflow-hidden mb-7">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-700 via-blue-400 to-blue-300 bg-[length:200%_auto] animate-shimmer transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-2 text-left">
          {STEPS.map(({ id, label }, i) => {
            const isDone = doneSet.has(id);
            const isActive = active === id;

            return (
              <div
                key={id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-300
                                    ${
                                      isDone
                                        ? "bg-gray-50"
                                        : isActive
                                          ? "bg-blue-50 border border-blue-100"
                                          : ""
                                    }`}
              >
                {/* Step indicator */}
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all
                                    ${
                                      isDone
                                        ? "bg-blue-700"
                                        : isActive
                                          ? "bg-blue-400"
                                          : "bg-gray-100 border border-gray-200"
                                    }`}
                >
                  {isDone ? (
                    <svg
                      className="w-2.5 h-2.5"
                      fill="none"
                      stroke="white"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 12 12"
                    >
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  ) : isActive ? (
                    <svg
                      className="w-2.5 h-2.5 animate-spin"
                      viewBox="0 0 10 10"
                    >
                      <circle
                        cx="5"
                        cy="5"
                        r="3.5"
                        fill="none"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeDasharray="7 5"
                      />
                    </svg>
                  ) : (
                    <span className="text-[10px] text-gray-400">{i + 1}</span>
                  )}
                </div>

                <span
                  className={
                    isDone
                      ? "text-gray-400"
                      : isActive
                        ? "font-medium text-blue-900"
                        : "text-gray-300"
                  }
                >
                  {label}
                </span>

                {isActive && (
                  <span className="ml-auto text-[11px] font-medium text-blue-500 whitespace-nowrap">
                    In progress
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
