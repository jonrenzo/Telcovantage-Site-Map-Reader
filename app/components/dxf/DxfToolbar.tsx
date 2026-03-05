interface Props {
    layerPanelOpen: boolean;
    onToggleLayerPanel: () => void;
    onFit: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    visibleCount: number;
    totalCount: number;
}

export default function DxfToolbar({
                                       layerPanelOpen, onToggleLayerPanel, onFit, onZoomIn, onZoomOut,
                                       visibleCount, totalCount,
                                   }: Props) {
    return (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
            {/* Layer panel toggle */}
            <button
                onClick={onToggleLayerPanel}
                title="Toggle layer panel"
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold shadow-sm transition-colors
          ${layerPanelOpen
                    ? "bg-accent text-white border-accent"
                    : "bg-surface text-muted border-border hover:bg-surface-2"}`}
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
                Layers
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono
          ${layerPanelOpen ? "bg-white/20 text-white" : "bg-surface-2 text-muted"}`}>
          {visibleCount}/{totalCount}
        </span>
            </button>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
                {[
                    { label: "⊡", title: "Fit to screen", onClick: onFit },
                    { label: "+", title: "Zoom in",        onClick: onZoomIn },
                    { label: "−", title: "Zoom out",       onClick: onZoomOut },
                ].map(({ label, title, onClick }) => (
                    <button
                        key={label}
                        title={title}
                        onClick={onClick}
                        className="w-8 h-8 flex items-center justify-center text-sm text-muted hover:bg-surface-2 hover:text-[#1e293b] transition-colors"
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}