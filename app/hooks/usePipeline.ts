import { useState, useRef, useCallback } from "react";
import type { DigitResult, Segment, PipelineStatus } from "../types";

interface RunOptions {
    dxfPath: string;
    layer: string;
}

interface PipelineState {
    status: PipelineStatus;
    progress: number;
    total: number;
    error: string | null;
    results: DigitResult[];
    segments: Segment[];
}

export function usePipeline() {
    const [state, setState] = useState<PipelineState>({
        status: "idle",
        progress: 0,
        total: 0,
        error: null,
        results: [],
        segments: [],
    });

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const run = useCallback(
        async (options: RunOptions) => {
            setState((prev) => ({
                ...prev,
                status: "processing",
                progress: 0,
                total: 0,
                error: null,
                results: [],
                segments: [],
            }));

            await fetch("/api/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dxf_path: options.dxfPath,
                    layer: options.layer,
                    model_path: "cad_digit_model.pt",
                }),
            });

            pollRef.current = setInterval(async () => {
                try {
                    const res = await fetch("/api/status");
                    const data = await res.json();

                    setState((prev) => ({
                        ...prev,
                        status: data.status,
                        progress: data.progress,
                        total: data.total,
                        error: data.error ?? null,
                    }));

                    if (data.status === "done") {
                        stopPolling();
                        const rres = await fetch("/api/results");
                        const rdata = await rres.json();
                        setState((prev) => ({
                            ...prev,
                            results: rdata.results,
                            segments: rdata.segments,
                        }));
                    } else if (data.status === "error") {
                        stopPolling();
                    }
                } catch (_) {}
            }, 600);
        },
        [stopPolling]
    );

    const reset = useCallback(() => {
        stopPolling();
        setState({
            status: "idle",
            progress: 0,
            total: 0,
            error: null,
            results: [],
            segments: [],
        });
    }, [stopPolling]);

    return { ...state, run, reset };
}