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
        <div className="absolute top-4 right-4 w-60 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden z-20">
            {/* Header */}
            <div className={`px-3.5 py-3 flex items-center justify-between ${result.manual ? "bg-[#8b5cf6]" : "bg-accent"}`}>
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                        Reading #{result.digit_id}
                    </h3>
                    {result.manual && (
                        <span className="text-[9px] bg-white/20 text-white px-1.5 py-0.5 rounded font-semibold">
              MANUAL
            </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="w-5 h-5 rounded-full bg-white/20 text-white hover:bg-white/35 flex items-center justify-center text-xs transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* Body */}
            <div className="p-3.5">
                {/* Show crop image only for OCR results, not manual entries */}
                {result.crop_b64 ? (
                    <img
                        src={`data:image/png;base64,${result.crop_b64}`}
                        alt="digit crop"
                        className="w-full aspect-square bg-black rounded-lg object-contain mb-3"
                        style={{ imageRendering: "pixelated" }}
                    />
                ) : (
                    <div className="w-full aspect-square bg-surface-2 rounded-lg flex items-center justify-center mb-3 border border-border">
                        <div className="text-center">
                            <div className="text-3xl mb-1">＋</div>
                            <p className="text-[10px] text-muted">Manually added</p>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[1.8rem] font-bold">
            {result.corrected_value ?? result.value}
          </span>
                    <span className="text-xs text-muted">
            {result.manual
                ? "manual entry"
                : `${Math.round(result.confidence * 100)}% confidence`}
          </span>
                </div>

                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mt-2.5 mb-1.5">
                    {result.manual ? "Edit value:" : "Correct value if wrong:"}
                </p>
                <div className="flex gap-1.5">
                    <input
                        ref={inputRef}
                        type="text"
                        maxLength={6}
                        placeholder="??"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 bg-surface-2 border-[1.5px] border-border rounded-lg px-2.5 py-2
              font-mono text-base text-center outline-none focus:border-accent transition-colors min-w-0"
                    />
                    <button
                        onClick={handleSave}
                        className="px-3 py-2 bg-ok text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors flex-shrink-0"
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