import type { PipelineStatus } from "../types";

interface Props {
  progress: number;
  total: number;
  status: PipelineStatus;
  step: number; // NEW — 1=extract 2=cluster 3=candidates 4=ocr
  stepLabel: string; // NEW — live label from backend
}

const STEPS = [
  { id: 1, label: "Finding strand segments" },
  { id: 2, label: "Grouping into digit clusters" },
  { id: 3, label: "Identifying candidates" },
  { id: 4, label: "Reading the numbers" },
];

export default function ProcessingScreen({
  progress,
  total,
  status,
  step,
  stepLabel,
}: Props) {
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <main className="flex-1 flex items-center justify-center p-8 bg-[#f4f6fb]">
      <div
        className="bg-white border border-gray-100 rounded-2xl p-10
                            max-w-sm w-full text-center shadow-sm"
      >
        {/* Spinner */}
        <div className="relative w-16 h-16 mx-auto mb-7">
          <div
            className="absolute inset-0 rounded-full border-2
                                    border-blue-400 animate-pulse"
          />
          <div
            className="absolute inset-3 rounded-full bg-blue-50
                                    flex items-center justify-center"
          >
            <svg
              className="w-[18px] h-[18px] animate-spin text-blue-700"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24
                                     16.24l2.83 2.83M2 12h4M18 12h4M4.93
                                     19.07l2.83-2.83M16.24 7.76l2.83-2.83"
              />
            </svg>
          </div>
        </div>

        <h2 className="text-base font-medium text-gray-900 mb-1.5">
          Reading your drawing
        </h2>

        {/* Live step label from backend */}
        <p
          className="text-sm text-blue-600 font-medium mb-1 min-h-[20px]
                              transition-all duration-300"
        >
          {stepLabel || "Starting up…"}
        </p>

        {/* Progress bar — only shown during OCR (step 4) */}
        {step === 4 && total > 0 && (
          <div className="mb-6 mt-3">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs text-gray-400">
                {progress} / {total} digits
              </span>
              <span className="text-xs font-medium text-gray-700">{pct}%</span>
            </div>
            <div className="bg-gray-100 rounded-full h-[5px] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r
                                           from-blue-700 via-blue-400 to-blue-300
                                           transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Pre-OCR spinner bar for steps 1-3 */}
        {step < 4 && (
          <div className="mb-6 mt-3">
            <div className="bg-gray-100 rounded-full h-[5px] overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-300
                                            animate-pulse w-full"
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Preparing drawing data…
            </p>
          </div>
        )}

        {/* Step indicators */}
        <div className="flex flex-col gap-2 text-left">
          {STEPS.map(({ id, label }) => {
            const isDone = step > id;
            const isActive = step === id;
            return (
              <div
                key={id}
                className={`flex items-center gap-3 px-3 py-2.5
                                             rounded-xl text-sm transition-all duration-300
                                             ${isDone ? "bg-gray-50" : ""}
                                             ${isActive ? "bg-blue-50 border border-blue-100" : ""}`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center
                                                 justify-center flex-shrink-0
                                                 ${isDone ? "bg-blue-700" : ""}
                                                 ${isActive ? "bg-blue-400" : "bg-gray-100 border border-gray-200"}`}
                >
                  {isDone ? (
                    <svg
                      className="w-2.5 h-2.5"
                      fill="none"
                      stroke="white"
                      strokeWidth="2.5"
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
                    <span className="text-[10px] text-gray-400">{id}</span>
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
                  <span
                    className="ml-auto text-[11px] font-medium
                                                     text-blue-500 whitespace-nowrap"
                  >
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
