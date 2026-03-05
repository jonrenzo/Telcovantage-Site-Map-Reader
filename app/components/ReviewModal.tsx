"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { DigitResult } from "../types";

interface Props {
    results: DigitResult[];
    onCorrect: (digitId: number, value: string | null) => void;
    onClose: () => void;
}

export default function ReviewModal({ results, onCorrect, onClose }: Props) {
    const queue = results.filter((r) => r.needs_review && !r.corrected_value);
    const [idx, setIdx] = useState(0);
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const current = queue[idx];

    useEffect(() => {
        setInput("");
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [idx]);

    const accept = useCallback(() => {
        if (!current) return;
        const val = input.trim();
        onCorrect(current.digit_id, val && val !== current.value ? val : null);
        if (idx + 1 >= queue.length) onClose();
        else setIdx((i) => i + 1);
    }, [current, input, idx, queue.length, onCorrect, onClose]);

    const skip = useCallback(() => {
        if (idx + 1 >= queue.length) onClose();
        else setIdx((i) => i + 1);
    }, [idx, queue.length, onClose]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); accept(); }
        if (e.key === "Tab")   { e.preventDefault(); skip(); }
    };

    if (!current) return null;

    return (
        <div
            className="fixed inset-0 bg-[rgba(15,23,42,0.6)] flex items-center justify-center z-50 backdrop-blur-sm w-full"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-surface rounded-2xl p-8 max-w-sm w-[90%] shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base font-bold">Check Uncertain Readings</h2>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 rounded-full bg-surface-2 hover:bg-border flex items-center justify-center text-sm transition-colors"
                    >
                        ✕
                    </button>
                </div>

                <p className="text-xs text-muted text-center mb-4">
                    {idx + 1} of {queue.length} uncertain readings
                </p>

                <img
                    src={`data:image/png;base64,${current.crop_b64}`}
                    alt="digit"
                    className="w-44 h-44 bg-black rounded-xl object-contain mx-auto mb-4"
                    style={{ imageRendering: "pixelated" }}
                />

                <div className="text-center mb-4">
                    <p className="text-xs text-muted mb-1">The model read this as:</p>
                    <p className="font-mono text-4xl font-bold text-accent">
                        {current.value}
                    </p>
                    <p className="text-xs text-muted mt-1">
                        {Math.round(current.confidence * 100)}% confident
                    </p>
                </div>

                <p className="text-xs font-semibold text-muted text-center mb-2">
                    Type the correct number if it&apos;s wrong, or press Accept:
                </p>
                <input
                    ref={inputRef}
                    type="text"
                    maxLength={3}
                    placeholder="??"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-surface-2 border-2 border-border rounded-xl px-3 py-3
            font-mono text-2xl text-center outline-none focus:border-accent transition-colors mb-3"
                />

                <div className="flex gap-2">
                    <button
                        onClick={accept}
                        className="flex-1 py-3 bg-ok text-white rounded-xl font-semibold text-sm hover:bg-green-700 transition-colors"
                    >
                        ✓ Accept
                    </button>
                    <button
                        onClick={skip}
                        className="px-4 py-3 bg-surface-2 text-muted rounded-xl text-sm hover:bg-border transition-colors"
                    >
                        Skip →
                    </button>
                </div>
                <p className="text-[10px] text-muted-2 text-center mt-2.5">
                    Enter = Accept · Tab = Skip
                </p>
            </div>
        </div>
    );
}