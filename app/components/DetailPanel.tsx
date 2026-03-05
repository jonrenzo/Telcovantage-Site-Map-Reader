"use client";

import { useState, useEffect, useRef } from "react";
import type { DigitResult } from "../types";

interface Props {
    result: DigitResult;
    onClose: () => void;
    onSave: (value: string) => void;
}

export default function DetailPanel({ result, onClose, onSave }: Props) {
    const [input, setInput] = useState(result.corrected_value ?? "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setInput(result.corrected_value ?? "");
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [result.digit_id]); // eslint-disable-line

    const handleSave = () => onSave(input.trim());

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSave();
        if (e.key === "Escape") onClose();
    };

    return (
        <div className="absolute top-4 right-4 w-56 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden z-20">
            {/* Header */}
            <div className="bg-accent px-3 py-2.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Reading #{result.digit_id}</h3>
                <button
                    onClick={onClose}
                    className="w-5 h-5 rounded-full bg-white/20 text-white hover:bg-white/35 flex items-center justify-center text-xs transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* Body */}
            <div className="p-3">
                {/* Crop image */}
                <img
                    src={`data:image/png;base64,${result.crop_b64}`}
                    alt="digit crop"
                    className="w-full aspect-square bg-black rounded-lg object-contain mb-2.5"
                    style={{ imageRendering: "pixelated" }}
                />

                {/* Prediction row */}
                <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-2xl font-bold">
            {result.corrected_value ?? result.value}
          </span>
                    <span className="text-xs text-muted">
            {Math.round(result.confidence * 100)}% confidence
          </span>
                </div>

                {/* Divider */}
                <div className="border-t border-border mb-2.5" />

                {/* Correction */}
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Correct value if wrong:
                </p>
                <div className="flex gap-1.5">
                    <input
                        ref={inputRef}
                        type="text"
                        maxLength={3}
                        placeholder="??"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="min-w-0 flex-1 bg-surface-2 border-[1.5px] border-border rounded-lg px-2 py-1.5
              font-mono text-sm text-center outline-none focus:border-accent transition-colors"
                    />
                    <button
                        onClick={handleSave}
                        className="px-2.5 py-1.5 bg-ok text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors flex-shrink-0"
                    >
                        Save
                    </button>
                </div>
                <p className="text-[10px] text-muted-2 mt-2 text-center">
                    Press Enter to save · Esc to close
                </p>
            </div>
        </div>
    );
}