"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// ─── Data ─────────────────────────────────────────────────────────────────────
const STATS = [
  { num: "99%", label: "OCR Accuracy on printed pole IDs" },
  { num: "8×", label: "Faster than manual extraction" },
  { num: "10+", label: "DXF entity types supported" },
  { num: "360°", label: "Auto-rotation sweep for labels" },
];

const FEATURES = [
  {
    icon: "📐",
    title: "Strand Length OCR",
    desc: "TrOCR handwritten model reads strand digit clusters in a single batched pass. Two-pass strategy: fast-accept at ≥92% confidence, then full 4-rotation sweep for uncertain crops.",
  },
  {
    icon: "🏷️",
    title: "Pole ID Recognition",
    desc: "Printed-model OCR with 8-angle sweep (0°–315°) to handle any label orientation in real-world drawings. Character confusion correction handles common misreads like T/1/l/I.",
  },
  {
    icon: "⚙️",
    title: "Equipment Detection",
    desc: "Automatically classifies nodes, amplifiers, line extenders, tap splitters, and more. Polygon cycle detection finds shapes even when drawn as disconnected line segments.",
  },
  {
    icon: "🗺️",
    title: "Interactive DXF Viewer",
    desc: "Canvas-based viewer with layer toggling, zoom/pan, cable span management, split/undo operations, and PDF export. All layers rendered at native DXF coordinates.",
  },
  {
    icon: "📊",
    title: "Excel Export",
    desc: "Two-sheet workbook export: full detail with confidence scores + summary name list. UI renames are captured at export time so corrected names appear in the output.",
  },
  {
    icon: "☁️",
    title: "Cloud Deployed",
    desc: "Flask backend on Render with lazy TrOCR model loading to avoid cold-start timeouts. Next.js frontend on Vercel. Gunicorn multi-threaded for concurrent scans.",
  },
];

const BENTO = [
  {
    cols: "col-span-3",
    rows: "row-span-2",
    accent: true,
    num: "01",
    tag: "Upload & Parse",
    title: "Intelligent DXF Segmentation",
    desc: "ezdxf parses every entity — LINE, LWPOLYLINE, ARC, SPLINE, CIRCLE — across all layout spaces. Segments are cluster-connected by endpoint proximity using a spatial grid for O(n log n) performance, even on drawings with 100k+ entities.",
  },
  {
    cols: "col-span-3",
    rows: "",
    accent: false,
    num: "02",
    tag: "OCR Pipeline",
    title: "TrOCR Batched Inference",
    desc: "All crops × all rotations fed into a single generate() call — 4–8× faster than sequential passes. Token-level probabilities give per-character confidence scores.",
  },
  {
    cols: "col-span-2",
    rows: "",
    accent: false,
    num: "03",
    tag: "Shape Service",
    title: "Polygon Cycle Detection",
    desc: "Graph-based cycle finding identifies triangles, rectangles, hexagons even from disconnected strokes — the way engineers actually draw equipment symbols.",
  },
  {
    cols: "col-span-2",
    rows: "",
    accent: false,
    num: "04",
    tag: "Review UI",
    title: "Human-in-the-Loop Correction",
    desc: "Uncertain readings surface in a focused review queue. Corrections update live state and flow directly into Excel exports — no server round-trip needed.",
  },
  {
    cols: "col-span-2",
    rows: "",
    accent: false,
    num: "05",
    tag: "Boundary Mask",
    title: "Spatial Filtering",
    desc: "Optional boundary polygon clips results to the exact work area, removing stray entities outside the drawing's scope using point-in-polygon ray casting.",
  },
];

const WORKFLOW = [
  {
    num: "01 —",
    title: "Upload your DXF file",
    desc: "Drag and drop or browse. PDF files are auto-converted via AutoCAD if available. The file index persists across sessions.",
    chips: [".dxf", ".pdf → .dxf", "folder organisation"],
  },
  {
    num: "02 —",
    title: "Auto-detect layers & scan",
    desc: "Strand, pole, and equipment layers are identified by name pattern. OCR and shape detection run in parallel background threads.",
    chips: ["auto-layer detection", "progress polling"],
  },
  {
    num: "03 —",
    title: "Review, correct & export",
    desc: "Low-confidence readings enter a review queue. Rename poles inline. Export structured Excel workbooks with a single click.",
    chips: ["inline review", "xlsx export", "PDF report"],
  },
];

const BULLETS = [
  "Session cache: revisit files without re-running OCR",
  "Auto-scan fires as soon as a DXF is loaded — results ready when you open the Poles tab",
  "Cable spans clickable directly on the map — split, merge, and tag recovery status",
];

const GOAL_PILLARS = [
  { icon: "⚡", label: "Speed", text: "Minutes, not hours, per drawing" },
  {
    icon: "🎯",
    label: "Accuracy",
    text: "AI-verified readings with confidence scores",
  },
  {
    icon: "📤",
    label: "Output",
    text: "Structured Excel data, ready for your workflow",
  },
];

// ─── Chatbot ──────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}
interface ChatRule {
  keywords: string[];
  response: string;
}

const CHAT_RULES: ChatRule[] = [
  {
    keywords: [
      "hello",
      "hi",
      "hey",
      "howdy",
      "greetings",
      "good morning",
      "good afternoon",
      "sup",
      "yo",
    ],
    response:
      "Hey there! 👋 I'm the AsBuiltIQ assistant. I can help with questions about the app — uploading DXF files, what gets detected, how OCR works, or exporting results. What would you like to know?",
  },
  {
    keywords: [
      "what is",
      "what does",
      "about",
      "overview",
      "explain",
      "tell me",
      "describe",
      "purpose",
      "asbuiltiq",
    ],
    response:
      "AsBuiltIQ is an AI-powered CAD drawing analysis tool for telecom infrastructure engineers.\n\nIt automatically processes DXF drawings to:\n• Read strand line length values\n• Identify pole ID labels\n• Detect equipment like nodes, amplifiers, and tap splitters\n• Export everything to Excel\n\nUpload a .dxf file and get results in under 2 minutes.",
  },
  {
    keywords: [
      "how to use",
      "get started",
      "start",
      "begin",
      "first step",
      "how do i",
      "tutorial",
      "guide",
      "steps",
    ],
    response:
      'Getting started is simple:\n\n1️⃣  Click "Open App" and upload your .dxf file\n2️⃣  The app auto-detects your layers\n3️⃣  OCR runs automatically in the background\n4️⃣  Review uncertain readings in the Review tab\n5️⃣  Export to Excel with one click\n\nTip: PDF files are supported too — auto-converted to DXF if AutoCAD is installed.',
  },
  {
    keywords: [
      "upload",
      "file",
      "dxf",
      "pdf",
      "format",
      "supported",
      "import",
      "open",
    ],
    response:
      "AsBuiltIQ accepts .dxf and .pdf files.\n\n• .dxf — Processed directly, all layers parsed\n• .pdf — Auto-converted to DXF via AutoCAD (requires 2022+)\n\nDrag & drop or browse to upload. Files are cached so you don't re-run OCR on revisit.",
  },
  {
    keywords: [
      "strand",
      "ocr",
      "digit",
      "length",
      "number",
      "reading",
      "confidence",
      "accuracy",
      "handwritten",
    ],
    response:
      "Strand length detection uses TrOCR (Microsoft's handwritten model).\n\n• All crops batched into a single OCR pass for speed\n• Pass 1: fast-accept at ≥92% confidence\n• Pass 2: uncertain crops get a full 4-rotation sweep\n• Results show confidence scores — low confidence is flagged for review\n\nOverall accuracy: ~99% on clear drawings.",
  },
  {
    keywords: [
      "pole",
      "pole id",
      "pole label",
      "pole tag",
      "pole name",
      "identifier",
      "tag",
    ],
    response:
      "Pole ID recognition uses TrOCR's printed text model.\n\n• 8-angle sweep: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°\n• Character confusion correction: T/1/l/I/7 auto-fixed\n• Results in the Pole IDs tab with crop previews\n• Rename any pole inline — corrected name flows into Excel export\n\nAuto-scan fires on DXF load, results ready when you open the tab.",
  },
  {
    keywords: [
      "equipment",
      "node",
      "amplifier",
      "amp",
      "extender",
      "tap",
      "splitter",
      "shape",
      "hexagon",
      "rectangle",
    ],
    response:
      "Equipment detection finds:\n\n🔵 Nodes — tall rectangles\n🟠 Amplifiers — wide rectangles\n🔺 Line Extenders — triangles\n🔷 2-Way Taps — circles\n🟩 4-Way Taps — squares\n⬡ 8-Way Taps — hexagons\n\nUses polygon cycle detection on DXF segments — finds shapes even from disconnected lines.",
  },
  {
    keywords: [
      "viewer",
      "view",
      "map",
      "canvas",
      "layer",
      "zoom",
      "pan",
      "dxf viewer",
      "visual",
    ],
    response:
      "The DXF Viewer gives you a full interactive canvas:\n\n• Toggle individual layers on/off (grouped by type)\n• Zoom & pan with mouse wheel and drag\n• Click cable spans to select, tag recovery status\n• Split or merge spans by double-clicking\n• Connect poles to cable spans\n• Export current view to PDF",
  },
  {
    keywords: [
      "cable",
      "span",
      "split",
      "merge",
      "recover",
      "recovery",
      "missing",
      "partial",
      "runs",
    ],
    response:
      "Cable span management:\n\n• Select a span by clicking\n• Split by double-clicking at the cut point\n• Merge adjacent spans by double-clicking near the endpoint\n• Tag status: Recovered ✅, Unrecovered/Partial ⚠️, Missing ❌\n• Cable runs: group parallel spans sharing the same path\n• Undo with Ctrl+Z",
  },
  {
    keywords: [
      "export",
      "excel",
      "xlsx",
      "download",
      "report",
      "save",
      "output",
    ],
    response:
      "Two export types:\n\nExcel (.xlsx)\n• Sheet 1: Full detail — Digit ID, value, confidence %, coordinates\n• Sheet 2: Pole names summary with total count\n• Inline renames captured at export time\n\nPDF Report (from DXF Viewer)\n• Full drawing image with status overlays\n• Tagged cable spans with length calculations",
  },
  {
    keywords: [
      "review",
      "correct",
      "correction",
      "wrong",
      "fix",
      "uncertain",
      "manual",
      "edit",
    ],
    response:
      "Low-confidence OCR readings are flagged for review automatically.\n\nOCR Review tab:\n• Queue with crop previews for each uncertain reading\n• Accept as-is, or type the correct value\n• Enter to accept, Tab to skip\n• Manually place digits by clicking the map\n\nPole IDs tab:\n• Click any pole row to expand\n• Type the correct name and press Save or Enter",
  },
  {
    keywords: [
      "tech",
      "stack",
      "technology",
      "flask",
      "next",
      "python",
      "react",
      "model",
      "trocr",
      "ai",
      "machine learning",
    ],
    response:
      "Tech stack:\n\nBackend — Python/Flask on Render\n• HuggingFace TrOCR models\n• ezdxf for DXF parsing\n• OpenCV & PIL for image processing\n• openpyxl for Excel generation\n\nFrontend — Next.js/TypeScript on Vercel\n• Canvas-based DXF renderer\n• Tailwind CSS v4\n• Session cache for fast revisits",
  },
  {
    keywords: [
      "deploy",
      "host",
      "vercel",
      "render",
      "cloud",
      "server",
      "production",
    ],
    response:
      "Fully cloud-deployed:\n\n• Frontend → Vercel (Next.js)\n• Backend → Render (Flask + Gunicorn)\n\nLazy TrOCR singleton loading prevents cold-start timeouts. NEXT_PUBLIC_BACKEND_URL connects the two.",
  },
  {
    keywords: ["layer", "layers", "toggle", "hide", "show", "visibility"],
    response:
      "Layers are auto-detected and grouped:\n\n• Equipment — nodes, amps, poles\n• Cable Strand — strand, cable layers\n• Tapoffs/Splitters — tapoff, splitter layers\n• Other — everything else\n\nToggle layers or entire groups in the DXF Viewer.",
  },
  {
    keywords: [
      "fast",
      "speed",
      "slow",
      "performance",
      "how long",
      "time",
      "quick",
      "batch",
    ],
    response:
      "Speed highlights:\n\n• 8× faster than manual extraction\n• All OCR crops batched in one model inference call\n• Typical drawing: results in under 2 minutes\n• Previously processed files cached — reopening skips OCR\n• Pole auto-scan starts in the background on file load",
  },
  {
    keywords: [
      "price",
      "pricing",
      "cost",
      "free",
      "paid",
      "subscription",
      "plan",
      "license",
    ],
    response:
      "For pricing and licensing information, please contact the AsBuiltIQ team directly. The app is currently in active development for telecom infrastructure use cases.",
  },
  {
    keywords: [
      "contact",
      "support",
      "help",
      "issue",
      "bug",
      "problem",
      "feedback",
    ],
    response:
      "Need help or found a bug?\n\n• Use the built-in review tools for OCR issues\n• Check that DXF layers follow standard naming (e.g. 'STRAND_TEXT', 'POLE_IDS')\n• For persistent issues, reach out to the AsBuiltIQ team\n\nIs there a specific issue I can help troubleshoot?",
  },
  {
    keywords: [
      "thank",
      "thanks",
      "thx",
      "appreciate",
      "great",
      "awesome",
      "perfect",
      "helpful",
    ],
    response:
      'Happy to help! 😊 If you have more questions, just ask. Ready to try it out? Hit the "Open App" button!',
  },
  {
    keywords: ["bye", "goodbye", "see you", "later", "ciao", "done", "exit"],
    response:
      "Goodbye! Feel free to come back anytime. Good luck with your drawings! 👋",
  },
];

const FALLBACK =
  "I'm best at answering questions about AsBuiltIQ specifically. Try asking about:\n\n• How to upload DXF files\n• Strand OCR or pole detection\n• Equipment shapes detected\n• Exporting to Excel\n• The DXF Viewer features\n\nWhat would you like to know?";

const QUICK_REPLIES = [
  "What does this app do?",
  "How do I get started?",
  "How does OCR work?",
  "What equipment is detected?",
];

/**
 * getResponse — keyword matcher.
 *
 * TO UPGRADE TO LLM: Replace this function with an async fetch to your LLM endpoint.
 * Signature: async function getResponse(text: string, history: ChatMessage[]): Promise<string>
 * Then update send() to: const reply = await getResponse(text, messages);
 */
function getResponse(text: string): string {
  const lower = text.toLowerCase();
  for (const rule of CHAT_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.response;
  }
  return FALLBACK;
}

// ─── Chatbot Component ────────────────────────────────────────────────────────
function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hi! I'm the AsBuiltIQ assistant. 👋\n\nAsk me anything about the app — how it works, what it detects, or how to get started.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showQuick, setShowQuick] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setShowQuick(false);
    setMessages((p) => [...p, { role: "user", text: msg }]);
    setInput("");
    setLoading(true);
    // Simulated delay — swap for async LLM call when upgrading
    setTimeout(
      () => {
        setMessages((p) => [
          ...p,
          { role: "assistant", text: getResponse(msg) },
        ]);
        setLoading(false);
      },
      600 + Math.random() * 400,
    );
  };

  const reset = () => {
    setMessages([
      {
        role: "assistant",
        text: "Hi! I'm the AsBuiltIQ assistant. 👋\n\nAsk me anything about the app — how it works, what it detects, or how to get started.",
      },
    ]);
    setShowQuick(true);
    setInput("");
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Chat with AsBuiltIQ Assistant"
        className={`fixed bottom-7 right-7 z-[200] w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 ${
          open
            ? "bg-[#0c3a1e] border border-[rgba(30,210,122,0.4)] scale-95 shadow-[0_0_0_1px_rgba(30,210,122,0.2),0_4px_20px_rgba(0,0,0,0.5)]"
            : "bg-[#00704A] border border-[rgba(0,160,96,0.6)] shadow-[0_0_0_1px_rgba(0,160,96,0.5),0_4px_20px_rgba(0,112,74,0.5),0_0_40px_rgba(0,112,74,0.2)]"
        }`}
      >
        {open ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1ed27a"
            strokeWidth="2.5"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
        {!open && (
          <span
            className="absolute inset-[-4px] rounded-full border-2 border-[rgba(0,160,96,0.4)] pointer-events-none"
            style={{ animation: "chatPulse 2s ease-in-out infinite" }}
          />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-7 z-[200] w-[360px] max-w-[calc(100vw-2rem)] flex flex-col overflow-hidden rounded-[18px] border border-[rgba(30,210,122,0.2)] bg-[#02200f] shadow-[0_0_0_1px_rgba(0,112,74,0.1),0_24px_60px_rgba(0,0,0,0.7),0_0_80px_rgba(0,112,74,0.08)]"
          style={{ animation: "chatSlideIn 0.25s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#072b16] border-b border-white/[0.08]">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-[#00704A] to-[#1ed27a] shadow-[0_0_12px_rgba(0,112,74,0.4)]">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6M9 12h6M9 15h4" />
              </svg>
            </div>
            <div>
              <div className="text-[0.85rem] font-bold text-[#e8f0eb] leading-tight">
                AsBuiltIQ Assistant
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-[#1ed27a] shadow-[0_0_6px_#1ed27a]"
                  style={{ animation: "pulse 2s infinite" }}
                />
                <span className="text-[0.65rem] text-[#89a890]">
                  Always online
                </span>
              </div>
            </div>
            <button
              onClick={reset}
              title="Clear chat"
              className="ml-auto text-[#89a890] hover:text-[#1ed27a] transition-colors p-1 rounded-md"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 max-h-[340px]"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: "#0c3a1e transparent",
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 items-end ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="w-6 h-6 rounded-full flex-shrink-0 mb-0.5 flex items-center justify-center bg-gradient-to-br from-[#00704A] to-[#1ed27a]">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2.5"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M9 9h6M9 12h6M9 15h4" />
                    </svg>
                  </div>
                )}
                <div
                  className={`max-w-[78%] px-3 py-2.5 text-[0.82rem] leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "rounded-[14px_14px_4px_14px] bg-gradient-to-br from-[#00704A] to-[#005c3a] border border-[rgba(0,160,96,0.4)] text-white shadow-[0_2px_8px_rgba(0,112,74,0.25)]"
                      : "rounded-[14px_14px_14px_4px] bg-[#072b16] border border-white/[0.08] text-[#e8f0eb] shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {/* Quick reply chips */}
            {showQuick && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {QUICK_REPLIES.map((qr) => (
                  <button
                    key={qr}
                    onClick={() => send(qr)}
                    className="text-[0.72rem] px-3 py-1.5 rounded-full bg-transparent border border-[rgba(30,210,122,0.35)] text-[#1ed27a] hover:bg-[rgba(30,210,122,0.1)] transition-colors cursor-pointer"
                  >
                    {qr}
                  </button>
                ))}
              </div>
            )}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-2 items-end justify-start">
                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-[#00704A] to-[#1ed27a]">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 9h6M9 12h6M9 15h4" />
                  </svg>
                </div>
                <div className="flex gap-1.5 items-center px-3.5 py-3 rounded-[14px_14px_14px_4px] bg-[#072b16] border border-white/[0.08]">
                  {[0, 200, 400].map((ms) => (
                    <div
                      key={ms}
                      className="w-1.5 h-1.5 rounded-full bg-[#1ed27a]"
                      style={{
                        animation: `typingDot 1.2s ${ms}ms ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="flex gap-2 items-center p-3 border-t border-white/[0.08] bg-[#072b16]">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about AsBuiltIQ…"
              disabled={loading}
              className="flex-1 bg-[#0c3a1e] border border-white/[0.08] focus:border-[rgba(30,210,122,0.4)] rounded-[10px] px-3 py-2 text-[0.82rem] text-[#e8f0eb] placeholder:text-[#89a890] outline-none transition-colors disabled:opacity-50"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className={`w-9 h-9 flex-shrink-0 rounded-[10px] flex items-center justify-center transition-all ${
                input.trim()
                  ? "bg-[#00704A] border border-[rgba(0,160,96,0.5)] shadow-[0_2px_8px_rgba(0,112,74,0.3)] cursor-pointer hover:bg-[#00a060]"
                  : "bg-[#0c3a1e] border border-white/[0.08] cursor-default"
              }`}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke={input.trim() ? "white" : "#89a890"}
                strokeWidth="2.5"
              >
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes chatPulse   { 0%,100%{ transform:scale(1);   opacity:.6; } 50%{ transform:scale(1.2); opacity:0; } }
        @keyframes chatSlideIn { from{ opacity:0; transform:translateY(16px) scale(.97); } to{ opacity:1; transform:translateY(0) scale(1); } }
        @keyframes typingDot   { 0%,60%,100%{ transform:translateY(0); opacity:.4; } 30%{ transform:translateY(-5px); opacity:1; } }
      `}</style>
    </>
  );
}

// ─── Mock App preview ─────────────────────────────────────────────────────────
function MockApp() {
  const layers = [
    { label: "STRAND_TEXT", color: "#1ed27a", active: true },
    { label: "POLE_IDS", color: "#fbbf24", active: false },
    { label: "AMPLIFIERS", color: "#93c5fd", active: false },
    { label: "CABLE", color: "#f9a8d4", active: false },
    { label: "NODES", color: "#a78bfa", active: false },
  ];
  return (
    <div className="relative rounded-[20px] p-px border border-white/[0.06] bg-gradient-to-br from-white/[0.06] to-white/[0.02] shadow-[0_0_0_1px_rgba(0,112,74,0.08),0_32px_80px_rgba(0,0,0,0.6),0_0_100px_rgba(0,112,74,0.08)]">
      <div className="absolute top-0 left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-[rgba(0,112,74,0.5)] to-transparent" />
      <div className="rounded-[19px] overflow-hidden bg-[#072b16]">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-5 py-3 bg-[#0c3a1e] border-b border-white/[0.06]">
          {["#ff5f57", "#ffbd2e", "#28c840"].map((c) => (
            <div
              key={c}
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: c }}
            />
          ))}
          <span className="flex-1 text-center font-mono text-[0.7rem] text-[rgba(232,240,235,0.5)] tracking-widest">
            AsBuiltIQ — STRAND_LAYOUT_v3.dxf
          </span>
        </div>
        {/* Body */}
        <div className="flex h-[480px]">
          {/* Sidebar */}
          <div className="w-[200px] flex-shrink-0 bg-black/25 border-r border-white/[0.06] p-4 flex flex-col gap-2">
            <div className="text-[0.6rem] font-mono text-[rgba(232,240,235,0.3)] uppercase tracking-[0.12em] mb-1">
              Layers
            </div>
            {layers.map(({ label, color, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[0.72rem] ${active ? "bg-[rgba(0,112,74,0.18)] text-[#1ed27a] border border-[rgba(0,112,74,0.25)]" : "text-[rgba(232,240,235,0.5)]"}`}
              >
                <div
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: color, opacity: active ? 1 : 0.6 }}
                />
                {label}
              </div>
            ))}
            <div className="mt-auto">
              <div className="text-[0.6rem] font-mono text-[rgba(232,240,235,0.3)] uppercase tracking-[0.12em] mb-1">
                OCR
              </div>
              <div className="text-[0.68rem] text-[#1ed27a] font-mono">
                247 detected
              </div>
              <div className="h-1 bg-white/[0.08] rounded-full mt-1.5">
                <div className="w-[91%] h-full bg-[#00704A] rounded-full" />
              </div>
              <div className="text-[0.58rem] text-[rgba(232,240,235,0.3)] mt-1 font-mono">
                91% confidence
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 relative overflow-hidden bg-[#061910]">
            <div
              className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[rgba(0,210,120,0.6)] to-transparent"
              style={{ animation: "scan 3s ease-in-out infinite" }}
            />
            {[
              { w: 180, t: "25%", l: "8%", r: "-5deg" },
              { w: 130, t: "32%", l: "20%", r: "8deg" },
              { w: 160, t: "45%", l: "35%", r: "-3deg" },
              { w: 100, t: "60%", l: "15%", r: "12deg" },
              { w: 200, t: "70%", l: "40%", r: "-8deg", faint: true },
              { w: 80, t: "50%", l: "60%", r: "20deg" },
              { w: 140, t: "38%", l: "55%", r: "-15deg" },
            ].map((s, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  width: s.w,
                  height: 1.5,
                  top: s.t,
                  left: s.l,
                  transform: `rotate(${s.r})`,
                  background: s.faint
                    ? "rgba(0,160,80,0.25)"
                    : "rgba(0,180,100,0.35)",
                }}
              />
            ))}
            {[
              { t: "23%", l: "25%" },
              { t: "42%", l: "48%" },
              { t: "62%", l: "28%", sm: true },
              { t: "68%", l: "72%", sm: true },
            ].map((c, i) => (
              <div
                key={i}
                className="absolute rounded-full border-2"
                style={{
                  width: c.sm ? 16 : 18,
                  height: c.sm ? 16 : 18,
                  top: c.t,
                  left: c.l,
                  borderColor: `rgba(251,191,36,${c.sm ? 0.5 : 0.7})`,
                  background: `rgba(251,191,36,${c.sm ? 0.08 : 0.12})`,
                }}
              />
            ))}
            <div
              className="absolute border border-[rgba(255,140,0,0.5)] bg-[rgba(255,140,0,0.05)] rounded-sm"
              style={{ width: 32, height: 18, top: "30%", left: "60%" }}
            />
            <div
              className="absolute border border-[rgba(147,197,253,0.5)] bg-[rgba(147,197,253,0.05)] rounded-sm"
              style={{ width: 28, height: 16, top: "55%", left: "75%" }}
            />
            {[
              { t: "21%", l: "27%", text: "T14", c: "rgba(30,210,122,0.8)" },
              { t: "40%", l: "50%", text: "T22", c: "rgba(30,210,122,0.8)" },
              { t: "26%", l: "8%", text: "125", c: "rgba(255,255,255,0.4)" },
              { t: "42%", l: "36%", text: "87", c: "rgba(255,255,255,0.4)" },
              { t: "67%", l: "14%", text: "203", c: "rgba(255,255,255,0.4)" },
            ].map((lb, i) => (
              <div
                key={i}
                className="absolute font-mono text-[0.6rem] tracking-[0.05em]"
                style={{ top: lb.t, left: lb.l, color: lb.c }}
              >
                {lb.text}
              </div>
            ))}
            <div
              className="absolute flex items-center justify-center font-mono text-[0.75rem] font-medium text-[#1ed27a] rounded border border-[rgba(30,210,122,0.8)] bg-[rgba(30,210,122,0.06)] shadow-[0_0_12px_rgba(30,210,122,0.2)]"
              style={{ width: 60, height: 28, top: "42%", left: "35%" }}
            >
              87 m
            </div>
          </div>

          {/* Info panel */}
          <div className="w-[180px] flex-shrink-0 bg-black/20 border-l border-white/[0.06] p-4 flex flex-col gap-3">
            <div className="text-[0.6rem] font-mono text-[rgba(232,240,235,0.3)] uppercase tracking-[0.12em] mb-1">
              Results
            </div>
            {[
              { label: "Strand", val: "247" },
              { label: "Poles", val: "38" },
              { label: "Equip.", val: "91" },
            ].map(({ label, val }) => (
              <div
                key={label}
                className="p-2.5 bg-white/[0.04] border border-white/[0.06] rounded-lg"
              >
                <div className="text-[0.6rem] font-mono text-[rgba(232,240,235,0.3)] uppercase tracking-[0.1em] mb-0.5">
                  {label}
                </div>
                <div className="text-lg font-bold text-[#1ed27a] font-mono">
                  {val}
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              {[
                {
                  bg: "rgba(0,112,74,0.2)",
                  col: "#1ed27a",
                  txt: "✓ Nodes: 14",
                },
                {
                  bg: "rgba(217,119,6,0.2)",
                  col: "#fbbf24",
                  txt: "● Amps: 22",
                },
                {
                  bg: "rgba(37,99,235,0.2)",
                  col: "#93c5fd",
                  txt: "◆ Taps: 55",
                },
              ].map(({ bg, col, txt }) => (
                <div
                  key={txt}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-[0.62rem]"
                  style={{ background: bg, color: col }}
                >
                  {txt}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  // Unlock body scroll (overrides app's h-screen overflow-hidden from layout.tsx)
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prev = {
      bo: body.style.overflow,
      bh: body.style.height,
      ho: html.style.overflow,
      hh: html.style.height,
    };
    body.style.overflow = "auto";
    body.style.height = "auto";
    html.style.overflow = "auto";
    html.style.height = "auto";
    body.classList.remove("overflow-hidden", "h-screen");
    html.classList.remove("overflow-hidden", "h-screen");
    return () => {
      body.style.overflow = prev.bo;
      body.style.height = prev.bh;
      html.style.overflow = prev.ho;
      html.style.height = prev.hh;
      body.classList.add("overflow-hidden", "h-screen");
    };
  }, []);

  // Scroll-reveal observer
  useEffect(() => {
    if (!document.getElementById("aiq-kf")) {
      const s = document.createElement("style");
      s.id = "aiq-kf";
      s.textContent = `
        @keyframes fadeUp { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes scan   { 0%{top:0;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes floatA { 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-30px) rotate(1.5deg)} }
        @keyframes floatB { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
        @keyframes floatC { 0%,100%{transform:translateY(0)} 50%{transform:translateY(25px)} }
        .aiq-reveal{opacity:0;transform:translateY(32px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}
        .aiq-reveal.visible{opacity:1;transform:translateY(0)}
        .d1{transition-delay:.1s} .d2{transition-delay:.2s} .d3{transition-delay:.3s} .d4{transition-delay:.4s}
      `;
      document.head.appendChild(s);
    }
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            obs.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    document.querySelectorAll(".aiq-reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      <div
        className="relative bg-[#02200f] text-[#e8f0eb] overflow-x-hidden antialiased"
        style={{ fontFamily: "'DM Sans',system-ui,sans-serif" }}
      >
        {/* Ambient blobs */}
        <div
          className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
          aria-hidden
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 900,
              height: 700,
              top: -200,
              left: "50%",
              background:
                "radial-gradient(ellipse, rgba(0,112,74,0.28) 0%, transparent 70%)",
              filter: "blur(120px)",
              animation: "floatA 12s ease-in-out infinite",
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 600,
              height: 500,
              top: "30%",
              left: -150,
              background:
                "radial-gradient(ellipse, rgba(0,80,50,0.20) 0%, transparent 70%)",
              filter: "blur(120px)",
              animation: "floatB 10s ease-in-out infinite",
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 500,
              height: 600,
              top: "20%",
              right: -100,
              background:
                "radial-gradient(ellipse, rgba(30,210,122,0.12) 0%, transparent 70%)",
              filter: "blur(100px)",
              animation: "floatC 14s ease-in-out infinite",
            }}
          />
        </div>

        {/* Grid overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-0"
          aria-hidden
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,112,74,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,112,74,0.04) 1px,transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse 80% 80% at 50% 0%,black 30%,transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 80% at 50% 0%,black 30%,transparent 100%)",
          }}
        />

        {/* ── NAV ─────────────────────────────────────────────────────────── */}
        <nav className="sticky top-0 z-[100] flex items-center justify-between px-8 h-[68px] bg-[rgba(2,26,14,0.85)] backdrop-blur-xl border-b border-white/[0.06]">
          <div
            className="flex items-center gap-2.5 font-bold text-[#e8f0eb]"
            style={{
              fontFamily: "'Libre Baskerville',serif",
              fontSize: "1.15rem",
            }}
          >
            <div className="w-7 h-7 rounded-[6px] flex items-center justify-center bg-[#00704A] shadow-[0_0_12px_rgba(0,112,74,0.5)]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline
                  points="9 22 9 12 15 12 15 22"
                  stroke="white"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </div>
            AsBuiltIQ
          </div>
          <div className="flex items-center gap-8">
            {["features", "how-it-works", "workflow"].map((id) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-[#89a890] hover:text-[#e8f0eb] transition-colors text-sm font-medium capitalize no-underline"
              >
                {id.replace(/-/g, " ")}
              </a>
            ))}
            <Link
              href="/"
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#00704A] hover:bg-[#00a060] transition-all shadow-[0_0_0_1px_rgba(0,160,96,0.4),0_4px_14px_rgba(0,112,74,0.35)] hover:-translate-y-px"
            >
              Open App →
            </Link>
          </div>
        </nav>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative z-[1] min-h-screen flex flex-col items-center justify-center text-center px-8 pt-12 pb-24">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[rgba(30,210,122,0.25)] bg-[rgba(30,210,122,0.07)] text-[#1ed27a] font-mono text-[0.7rem] tracking-[0.18em] uppercase mb-8"
            style={{ animation: "fadeUp 0.8s 0.2s ease both" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#1ed27a] shadow-[0_0_8px_#1ed27a]"
              style={{ animation: "pulse 2s infinite" }}
            />
            Telcovantage Philippines Services Inc.
          </div>

          <h1
            className="max-w-[900px] font-bold leading-[1.05] tracking-[-0.03em] mb-6"
            style={{
              fontFamily: "'Libre Baskerville',serif",
              fontSize: "clamp(2.8rem,6.5vw,6rem)",
              animation: "fadeUp 0.8s 0.35s ease both",
            }}
          >
            Identify Every Strand Line &amp; Equipment in Your{" "}
            <span className="bg-gradient-to-br from-[#1ed27a] via-[#00cc77] to-[#00a060] bg-clip-text text-transparent">
              AsBuilt Plans
            </span>
          </h1>

          <p
            className="max-w-[560px] text-[#89a890] leading-[1.75] mb-12"
            style={{
              fontSize: "clamp(1rem,2vw,1.2rem)",
              animation: "fadeUp 0.8s 0.5s ease both",
            }}
          >
            Upload your CAD drawings and let AI-powered OCR automatically detect
            strand lengths, pole identifiers, and equipment shapes across every
            layer — in seconds.
          </p>

          <div
            className="flex items-center gap-4 flex-wrap justify-center"
            style={{ animation: "fadeUp 0.8s 0.65s ease both" }}
          >
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-[10px] text-base font-semibold text-white bg-[#00704A] hover:bg-[#00a060] transition-all shadow-[0_0_0_1px_rgba(0,160,96,0.5),0_4px_16px_rgba(0,112,74,0.4)] hover:-translate-y-1 active:scale-[0.98]"
            >
              Launch Application →
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-7 py-4 rounded-[10px] text-base font-medium text-[#89a890] hover:text-[#e8f0eb] border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.07] hover:-translate-y-0.5 transition-all no-underline"
            >
              See how it works
            </a>
          </div>

          <div
            className="mt-20 w-full max-w-[1100px]"
            style={{ animation: "fadeUp 1s 0.85s ease both" }}
          >
            <MockApp />
          </div>
        </section>

        {/* ── STATS ────────────────────────────────────────────────────────── */}
        <div className="relative z-[1] max-w-[1160px] mx-auto px-8 mb-20">
          <div
            className="aiq-reveal grid grid-cols-4 rounded-2xl border border-white/[0.06] overflow-hidden bg-white/[0.06]"
            style={{ gap: "1px" }}
          >
            {STATS.map(({ num, label }) => (
              <div
                key={label}
                className="bg-[#072b16] px-8 py-10 text-center hover:bg-[#0c3a1e] transition-colors"
              >
                <div
                  className="font-bold leading-none mb-1.5 bg-gradient-to-br from-[#1ed27a] to-[#00a060] bg-clip-text text-transparent"
                  style={{
                    fontFamily: "'Libre Baskerville',serif",
                    fontSize: "2.8rem",
                  }}
                >
                  {num}
                </div>
                <div className="text-[0.8rem] text-[#89a890]">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── FEATURES ─────────────────────────────────────────────────────── */}
        <section id="features" className="relative z-[1] py-28 px-8">
          <div className="max-w-[1160px] mx-auto">
            <div className="aiq-reveal text-center mb-16">
              <span className="block font-mono text-[0.68rem] tracking-[0.2em] uppercase text-[#1ed27a] mb-4">
                Core Capabilities
              </span>
              <h2
                className="font-bold tracking-tight mb-4"
                style={{
                  fontFamily: "'Libre Baskerville',serif",
                  fontSize: "clamp(2rem,4vw,3rem)",
                }}
              >
                Everything your CAD team needs
              </h2>
              <p className="text-[#89a890] leading-[1.7] max-w-[520px] mx-auto">
                From DXF parsing to AI-powered recognition, AsBuiltIQ handles
                the full extraction pipeline.
              </p>
            </div>
            <div
              className="grid grid-cols-3 rounded-[20px] border border-white/[0.06] overflow-hidden"
              style={{ gap: "1.5px", background: "rgba(255,255,255,0.06)" }}
            >
              {FEATURES.map(({ icon, title, desc }, i) => (
                <div
                  key={title}
                  className={`aiq-reveal ${i % 3 === 1 ? "d1" : i % 3 === 2 ? "d2" : ""} bg-[#072b16] hover:bg-[#0c3a1e] p-10 transition-colors group`}
                >
                  <div className="w-11 h-11 flex items-center justify-center rounded-[10px] text-xl mb-5 bg-[rgba(0,112,74,0.15)] border border-[rgba(0,112,74,0.3)] group-hover:shadow-[0_0_20px_rgba(0,112,74,0.3)] transition-shadow">
                    {icon}
                  </div>
                  <div
                    className="font-bold text-[#e8f0eb] mb-2.5 tracking-tight"
                    style={{
                      fontFamily: "'Libre Baskerville',serif",
                      fontSize: "1.05rem",
                    }}
                  >
                    {title}
                  </div>
                  <div className="text-[0.875rem] text-[#89a890] leading-[1.65]">
                    {desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="relative z-[1] max-w-[900px] mx-auto h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

        {/* ── BENTO ────────────────────────────────────────────────────────── */}
        <section
          id="how-it-works"
          className="relative z-[1] py-28 px-8 bg-[#02200f]"
        >
          <div className="max-w-[1160px] mx-auto">
            <div className="aiq-reveal mb-14">
              <span className="block font-mono text-[0.68rem] tracking-[0.2em] uppercase text-[#1ed27a] mb-4">
                Under the Hood
              </span>
              <h2
                className="font-bold tracking-tight mb-4"
                style={{
                  fontFamily: "'Libre Baskerville',serif",
                  fontSize: "clamp(2rem,4vw,3rem)",
                }}
              >
                Precision at every stage
              </h2>
              <p className="text-[#89a890] leading-[1.7] max-w-[520px]">
                A multi-step AI pipeline processes your drawings from raw DXF
                data to structured, export-ready results.
              </p>
            </div>
            <div
              className="grid grid-cols-6 gap-4"
              style={{ gridAutoRows: "200px" }}
            >
              {BENTO.map(({ cols, rows, accent, num, tag, title, desc }, i) => (
                <div
                  key={title}
                  className={`aiq-reveal d${i % 4} ${cols} ${rows} relative overflow-hidden rounded-2xl p-7 flex flex-col justify-end border transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4),0_0_0_1px_rgba(0,112,74,0.1)] group cursor-default ${accent ? "border-[rgba(0,112,74,0.3)] bg-gradient-to-br from-[rgba(0,112,74,0.2)] to-[rgba(0,80,50,0.1)]" : "border-white/[0.06] bg-gradient-to-br from-white/[0.05] to-white/[0.02] hover:border-[rgba(0,112,74,0.3)]"}`}
                >
                  <div
                    className="absolute top-4 right-5 font-bold leading-none select-none text-[rgba(0,112,74,0.07)]"
                    style={{
                      fontFamily: "'Libre Baskerville',serif",
                      fontSize: "5rem",
                    }}
                  >
                    {num}
                  </div>
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[rgba(0,112,74,0.4)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="inline-block font-mono text-[0.62rem] tracking-[0.12em] uppercase text-[#1ed27a] bg-[rgba(30,210,122,0.1)] border border-[rgba(30,210,122,0.2)] px-2 py-0.5 rounded mb-2.5">
                    {tag}
                  </span>
                  <div
                    className="font-bold text-[#e8f0eb] mb-1.5 tracking-tight"
                    style={{
                      fontFamily: "'Libre Baskerville',serif",
                      fontSize: "1.1rem",
                    }}
                  >
                    {title}
                  </div>
                  <div className="text-[0.8rem] text-[#89a890] leading-[1.55]">
                    {desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── WORKFLOW ─────────────────────────────────────────────────────── */}
        <section
          id="workflow"
          className="relative z-[1] py-28 px-8 bg-[#04200f]"
        >
          <div className="max-w-[1160px] mx-auto grid grid-cols-2 gap-16 items-start">
            {/* Left col */}
            <div className="aiq-reveal">
              <span className="block font-mono text-[0.68rem] tracking-[0.2em] uppercase text-[#1ed27a] mb-4">
                Step-by-Step
              </span>
              <h2
                className="font-bold tracking-tight mb-4"
                style={{
                  fontFamily: "'Libre Baskerville',serif",
                  fontSize: "clamp(2rem,4vw,3rem)",
                }}
              >
                From file to results in three clicks
              </h2>
              <p className="text-[#89a890] leading-[1.7] mb-8">
                No configuration files. No manual layer selection required.
                AsBuiltIQ auto-detects your drawing structure and starts
                processing immediately.
              </p>

              {WORKFLOW.map(({ num, title, desc, chips }, i) => (
                <div
                  key={num}
                  className={`aiq-reveal d${i + 1} grid gap-8 px-4 py-10 rounded-lg hover:bg-white/[0.03] transition-colors ${i < WORKFLOW.length - 1 ? "border-b border-white/[0.06]" : ""}`}
                  style={{ gridTemplateColumns: "60px 1fr" }}
                >
                  <div className="font-mono text-[0.7rem] text-[#1ed27a] tracking-[0.1em] pt-1">
                    {num}
                  </div>
                  <div>
                    <div
                      className="font-bold text-[#e8f0eb] mb-1.5 tracking-tight"
                      style={{
                        fontFamily: "'Libre Baskerville',serif",
                        fontSize: "1.15rem",
                      }}
                    >
                      {title}
                    </div>
                    <div className="text-[0.875rem] text-[#89a890] leading-[1.65] mb-3">
                      {desc}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {chips.map((c) => (
                        <span
                          key={c}
                          className="font-mono text-[0.65rem] px-2.5 py-1 rounded bg-white/[0.04] border border-white/[0.06] text-[#89a890] tracking-[0.06em]"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right col */}
            <div className="aiq-reveal d2 pt-8">
              {/* ── Goal callout (replaces testimonial) ── */}
              <div className="relative overflow-hidden rounded-[20px] p-10 mb-6 border border-[rgba(0,112,74,0.3)] bg-gradient-to-br from-[rgba(0,112,74,0.08)] to-[rgba(0,40,25,0.05)]">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[rgba(0,160,96,0.5)] to-transparent" />

                {/* Icon */}
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 bg-[rgba(0,112,74,0.18)] border border-[rgba(0,112,74,0.35)]">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#1ed27a"
                    strokeWidth="2"
                  >
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </div>

                <p className="font-mono text-[0.65rem] tracking-[0.18em] uppercase text-[#1ed27a] mb-3">
                  Our Goal
                </p>

                <h3
                  className="font-bold text-[#e8f0eb] leading-snug tracking-tight mb-4"
                  style={{
                    fontFamily: "'Libre Baskerville',serif",
                    fontSize: "1.35rem",
                  }}
                >
                  Zero time wasted on manual drawing interpretation
                </h3>

                <p className="text-[0.9rem] text-[#89a890] leading-relaxed mb-6">
                  Telecom engineers shouldn't spend hours reading DXF files by
                  hand. AsBuiltIQ was built to eliminate that entirely — upload
                  your drawing, get structured data out. Every pole ID, every
                  strand length, every equipment shape, automatically extracted
                  and ready for your workflow.
                </p>

                <div className="flex flex-col gap-3">
                  {GOAL_PILLARS.map(({ icon, label, text }) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06]"
                    >
                      <span className="text-base flex-shrink-0">{icon}</span>
                      <span className="text-[0.78rem] font-semibold text-[#1ed27a] min-w-[72px]">
                        {label}
                      </span>
                      <span className="text-[0.78rem] text-[#89a890]">
                        {text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {BULLETS.map((b) => (
                <div
                  key={b}
                  className="flex items-center gap-3 px-5 py-4 mb-3 rounded-[10px] bg-white/[0.04] border border-white/[0.06]"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0 bg-[#1ed27a] shadow-[0_0_8px_#1ed27a]" />
                  <span className="text-[0.82rem] text-[#89a890]">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <section className="relative z-[1] text-center py-36 px-8">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse, rgba(0,112,74,0.2) 0%, transparent 70%)",
              filter: "blur(60px)",
            }}
          />
          <div className="relative max-w-[1160px] mx-auto">
            <div className="aiq-reveal">
              <h2
                className="font-bold tracking-[-0.03em] leading-[1.1] mb-5"
                style={{
                  fontFamily: "'Libre Baskerville',serif",
                  fontSize: "clamp(2.2rem,5vw,4rem)",
                }}
              >
                Ready to read your drawings
                <br />
                faster than ever?
              </h2>
              <p className="text-[#89a890] leading-[1.7] mb-10 text-base">
                Upload a DXF file and get your first results in under two
                minutes. No setup required.
              </p>
              <div className="flex gap-4 justify-center flex-wrap">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-9 py-4 rounded-[10px] text-[1.05rem] font-semibold text-white bg-[#00704A] hover:bg-[#00a060] transition-all shadow-[0_0_0_1px_rgba(0,160,96,0.5),0_4px_16px_rgba(0,112,74,0.4)] hover:-translate-y-1"
                >
                  Open AsBuiltIQ →
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 px-7 py-4 rounded-[10px] text-[1.05rem] font-medium text-[#89a890] hover:text-[#e8f0eb] border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.07] transition-all no-underline"
                >
                  Learn more
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <footer className="relative z-[1] bg-[#02200f] border-t border-white/[0.06] py-12 px-8">
          <div className="max-w-[1160px] mx-auto flex items-center justify-between flex-wrap gap-6">
            <div
              className="font-bold text-[#89a890]"
              style={{ fontFamily: "'Libre Baskerville',serif" }}
            >
              AsBuilt<span className="text-[#1ed27a]">IQ</span>
            </div>
            <div className="flex gap-7">
              {["Features", "Workflow", "App"].map((l) => (
                <a
                  key={l}
                  href={l === "App" ? "/" : `#${l.toLowerCase()}`}
                  className="text-[0.8rem] text-[#89a890] hover:text-[#1ed27a] transition-colors no-underline"
                >
                  {l}
                </a>
              ))}
            </div>
            <div className="text-[0.78rem] text-[rgba(232,240,235,0.5)]">
              © 2026 AsBuiltIQ · Telcovantage Philippines Services Inc.
            </div>
          </div>
        </footer>
      </div>

      {/* Chatbot sits outside page wrapper so it's always fixed on screen */}
      <Chatbot />
    </>
  );
}
