interface Props {
    onStartOver: () => void;
}

export default function ExportDone({ onStartOver }: Props) {
    return (
        <main className="flex-1 flex items-center justify-center bg-[#f4f6fb]">
            <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm w-full text-center shadow-sm flex flex-col items-center gap-4">
                <div className="text-5xl">✅</div>
                <h2 className="text-lg font-bold">Excel file saved!</h2>
                <p className="text-muted text-sm leading-relaxed">
                    Your results have been saved to an Excel file in the same folder as
                    your drawing.
                </p>
                <button
                    onClick={onStartOver}
                    className="mt-2 px-6 py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors"
                >
                    Process another drawing
                </button>
            </div>
        </main>
    );
}