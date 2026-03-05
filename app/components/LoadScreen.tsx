"use client";

import { useState, useRef, useCallback } from "react";

type UploadState = "idle" | "uploading" | "loaded" | "error";

interface UploadProgress {
    phase: "uploading" | "converting" | "reading_layers" | "checking_model" | "done";
    label: string;
    pct: number;
}

interface Props {
    onStartProcessing: (opts: {
        dxfPath: string;
        layer: string;
        allLayers: string[];
    }) => void;
}

const PHASES: Record<UploadProgress["phase"], { label: string; pct: number }> = {
    uploading:      { label: "Uploading file…",         pct: 20  },
    converting:     { label: "Converting PDF to DXF…",  pct: 45  },
    reading_layers: { label: "Reading layers…",         pct: 70  },
    checking_model: { label: "Checking model…",         pct: 90  },
    done:           { label: "Ready",                   pct: 100 },
};

export default function LoadScreen({ onStartProcessing }: Props) {
    const [uploadState, setUploadState] = useState<UploadState>("idle");
    const [progress, setProgress]       = useState<UploadProgress | null>(null);
    const [dxfPath, setDxfPath]         = useState("");
    const [displayName, setDisplayName] = useState("");
    const [layers, setLayers]           = useState<string[]>([]);
    const [selectedLayer, setSelectedLayer] = useState("");
    const [suggestedLayer, setSuggestedLayer] = useState("");
    const [modelOk, setModelOk]         = useState<boolean | null>(null);
    const [dragOver, setDragOver]       = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const setPhase = (phase: UploadProgress["phase"]) =>
        setProgress({ phase, ...PHASES[phase] });

    const handleFile = useCallback(async (file: File) => {
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        if (!file.name.endsWith(".dxf") && !isPdf) {
            alert("Please select a DXF or PDF file.");
            return;
        }

        setUploadState("uploading");
        setLayers([]);
        setModelOk(null);
        setPhase("uploading");

        const fd = new FormData();
        fd.append("file", file);

        try {
            if (isPdf) setPhase("converting");
            const res  = await fetch("/api/upload", { method: "POST", body: fd });
            const data = await res.json();

            if (data.error) {
                setUploadState("error");
                setProgress(null);
                alert("Could not open file: " + data.error);
                return;
            }

            if (data.path.toLowerCase().endsWith(".pdf")) {
                setUploadState("error");
                setProgress(null);
                alert("File could not be converted to DXF. Please upload a DXF directly.");
                return;
            }

            const name = data.converted_from
                ? `${file.name} → ${data.path}`
                : file.name;
            setDxfPath(data.path);
            setDisplayName(name);

            // Layers
            setPhase("reading_layers");
            const lres  = await fetch("/api/layers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dxf_path: data.path }),
            });
            const ldata = await lres.json();
            if (ldata.error) {
                setUploadState("error");
                setProgress(null);
                alert("Could not read layers: " + ldata.error);
                return;
            }
            setLayers(ldata.layers);
            const suggested = ldata.layers.find((l: string) =>
                l.toLowerCase().includes("strand")
            ) ?? "";
            setSuggestedLayer(suggested);
            setSelectedLayer(suggested || ldata.layers[0] || "");

            // Model
            setPhase("checking_model");
            const mres  = await fetch("/api/check_model");
            const mdata = await mres.json();
            setModelOk(mdata.ok);

            setPhase("done");
            setUploadState("loaded");
        } catch (e) {
            setUploadState("error");
            setProgress(null);
            alert("Upload failed: " + (e as Error).message);
        }
    }, []);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const canRun = uploadState === "loaded" && selectedLayer && modelOk;

    return (
        <main className="flex-1 flex items-center justify-center p-8 bg-[#f4f6fb]">
            <div className="bg-surface border border-border rounded-2xl shadow-sm w-full max-w-3xl overflow-hidden">

                {/* ── Two-column layout ── */}
                <div className="flex">

                    {/* Left — drop zone */}
                    <div className="w-72 shrink-0 border-r border-border p-8 flex flex-col items-center justify-center gap-4 bg-[#f8f9fc]">
                        <div
                            className={`w-full border-2 rounded-xl p-7 text-center cursor-pointer transition-all duration-200
                                ${dragOver
                                ? "border-accent bg-accent-light"
                                : uploadState === "loaded"
                                    ? "border-ok bg-ok-light border-solid"
                                    : "border-border border-dashed bg-surface hover:border-accent hover:bg-accent-light"
                            }`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={onDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".dxf,.pdf"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                            />
                            <div className="text-4xl mb-3 flex items-center justify-center">
                                {uploadState === "uploading" ? (
                                    <div className="w-10 h-10 border-4 border-border border-t-accent rounded-full animate-spin-fast" />
                                ) : uploadState === "loaded" ? (
                                    "✅"
                                ) : (
                                    "📂"
                                )}
                            </div>
                            {uploadState === "loaded" ? (
                                <>
                                    <div className="font-semibold text-sm text-ok">File loaded</div>
                                    <div className="text-ok text-xs font-semibold mt-1 break-all">✓ {displayName}</div>
                                    <div className="text-muted text-xs mt-2">Click to change</div>
                                </>
                            ) : (
                                <>
                                    <div className="font-semibold text-sm">Drop DXF or PDF here</div>
                                    <div className="text-muted text-xs mt-1">or click to browse</div>
                                </>
                            )}
                        </div>

                        {/* Upload progress bar */}
                        {progress && uploadState === "uploading" && (
                            <div className="w-full">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-xs text-muted">{progress.label}</span>
                                    <span className="text-xs font-mono text-accent">{progress.pct}%</span>
                                </div>
                                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-accent rounded-full transition-all duration-500"
                                        style={{ width: `${progress.pct}%` }}
                                    />
                                </div>
                                <div className="flex justify-between mt-2.5">
                                    {(["uploading", "converting", "reading_layers", "checking_model", "done"] as const)
                                        .filter(p => p !== "converting" || displayName === "")
                                        .map((p) => {
                                            const reached = progress.pct >= PHASES[p].pct;
                                            return (
                                                <div
                                                    key={p}
                                                    className={`w-1.5 h-1.5 rounded-full transition-colors duration-300
                                                        ${reached ? "bg-accent" : "bg-border"}`}
                                                />
                                            );
                                        })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right — config */}
                    <div className="flex-1 p-8 flex flex-col justify-center gap-5">
                        <div>
                            <h2 className="text-xl font-bold mb-1">Open a CAD Drawing</h2>
                            <p className="text-muted text-sm leading-relaxed">
                                Drop your DXF or PDF file on the left, then select the layer
                                containing the strand numbers and run.
                            </p>
                        </div>

                        {/* Layer select */}
                        <div>
                            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                                Strand layer
                            </label>
                            {layers.length > 0 ? (
                                <>
                                    <select
                                        className="w-full bg-surface-2 border-[1.5px] border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent cursor-pointer"
                                        value={selectedLayer}
                                        onChange={(e) => setSelectedLayer(e.target.value)}
                                    >
                                        {layers.map((l) => (
                                            <option key={l} value={l}>{l}</option>
                                        ))}
                                    </select>
                                    {suggestedLayer && (
                                        <p className="text-xs text-ok font-semibold mt-1.5">
                                            ✓ Auto-detected: {suggestedLayer}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <div className="w-full bg-surface-2 border-[1.5px] border-border rounded-lg px-3 py-2.5 text-sm text-muted-2">
                                    Upload a file to see layers
                                </div>
                            )}
                        </div>

                        {/* Model status */}
                        <div>
                            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                                Model
                            </label>
                            {modelOk === null ? (
                                <div className="px-3.5 py-2.5 rounded-lg text-sm bg-surface-2 text-muted-2 border border-border">
                                    Waiting for file upload…
                                </div>
                            ) : (
                                <div className={`px-3.5 py-2.5 rounded-lg text-sm border
                                    ${modelOk
                                    ? "bg-ok-light text-ok border-[#bbf7d0]"
                                    : "bg-danger-light text-danger border-[#fecaca]"}`}
                                >
                                    {modelOk
                                        ? "✓ Recognition model is ready"
                                        : "✗ cad_digit_model.pt not found in server folder"}
                                </div>
                            )}
                        </div>

                        {/* Run button */}
                        <button
                            disabled={!canRun}
                            onClick={() => onStartProcessing({ dxfPath, layer: selectedLayer, allLayers: layers })}
                            className="w-full py-3.5 bg-accent text-white rounded-xl font-semibold text-sm
                                flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors
                                disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                             Read Drawing
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}