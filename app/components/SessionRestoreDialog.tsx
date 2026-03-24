"use client";

import { useCallback } from "react";
import type { SessionSummary } from "../lib/supabase";

interface Props {
  summary: SessionSummary;
  onLoadSaved: () => void;
  onRescanFresh: () => void;
  onCancel: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SessionRestoreDialog({
  summary,
  onLoadSaved,
  onRescanFresh,
  onCancel,
}: Props) {
  const { session, counts, config } = summary;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onLoadSaved();
      }
    },
    [onCancel, onLoadSaved]
  );

  const hasData =
    counts.digit_results > 0 ||
    counts.equipment_shapes > 0 ||
    counts.poles > 0 ||
    counts.cable_spans > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Previous Scan Found
              </h2>
              <p className="text-sm text-gray-500">
                {summary.project.dxf_file_name}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {hasData ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                We found saved data from a previous scan. Would you like to load
                it or start fresh?
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {counts.digit_results > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg">
                    <span className="text-lg">123</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {counts.digit_results}
                      </p>
                      <p className="text-xs text-gray-500">Strand readings</p>
                    </div>
                  </div>
                )}

                {counts.equipment_shapes > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg">
                    <span className="text-lg">&#9881;</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {counts.equipment_shapes}
                      </p>
                      <p className="text-xs text-gray-500">Equipment</p>
                    </div>
                  </div>
                )}

                {counts.poles > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
                    <span className="text-lg">&#128309;</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {counts.poles}
                      </p>
                      <p className="text-xs text-gray-500">Pole IDs</p>
                    </div>
                  </div>
                )}

                {counts.cable_spans > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
                    <span className="text-lg">&#128268;</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {counts.cable_spans}
                      </p>
                      <p className="text-xs text-gray-500">Cable spans</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Scan completion indicators */}
              {config && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {config.ocr_done && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      OCR Complete
                    </span>
                  )}
                  {config.equipment_done && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Equipment Done
                    </span>
                  )}
                  {config.poles_done && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Poles Done
                    </span>
                  )}
                  {counts.has_boundary && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                      </svg>
                      Boundary Set
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-600 mb-4">
              A previous session exists but has no saved data. Start a fresh
              scan?
            </p>
          )}

          {/* Last saved timestamp */}
          <p className="text-xs text-gray-400">
            Last saved: {formatDate(session.updated_at)}
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={onRescanFresh}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300"
          >
            Re-scan Fresh
          </button>
          <button
            onClick={onLoadSaved}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Load Saved
          </button>
        </div>
      </div>
    </div>
  );
}
