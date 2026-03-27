"use client";

import { useState, useEffect, useRef } from "react";
import { BeamsBackground } from "@/components/ui/beams-background";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & DATA
// ══════════════════════════════════════════════════════════════════════════════

const NGROK_BASE = "https://disguisedly-enarthrodial-kristi.ngrok-free.dev";
const ASBUILT_URL = "/";
const POLE_MASTER_URL = `${NGROK_BASE}/dashboard`;

// Color palette
const COLORS = {
  background: "#02200f",
  cardBg: "#072b16",
  cardBgHover: "#0a3d20",
  textPrimary: "#e8f0eb",
  textSecondary: "#89a890",
  asbuiltAccent: "#1ed27a",
  asbuiltDark: "#00704A",
  poleMasterAccent: "#fbbf24",
  poleMasterDark: "#b45309",
  border: "rgba(255,255,255,0.08)",
  borderLight: "rgba(255,255,255,0.12)",
};

// AsBuiltIQ Workflow
const ASBUILT_WORKFLOW = [
  {
    step: "01",
    title: "Upload DXF/PDF",
    desc: "Import your CAD drawings or PDF files. Supports batch uploads and folder organization.",
    icon: "upload",
  },
  {
    step: "02",
    title: "AI Analysis",
    desc: "TrOCR model scans all entities — strand lengths, pole IDs, equipment shapes — in parallel.",
    icon: "scan",
  },
  {
    step: "03",
    title: "Review & Correct",
    desc: "Uncertain readings surface in a focused review queue. Corrections update live state instantly.",
    icon: "review",
  },
  {
    step: "04",
    title: "Export Data",
    desc: "Download structured Excel workbooks with full detail sheets and summary reports.",
    icon: "export",
  },
];

// Pole Master Workflow
const POLE_MASTER_WORKFLOW = [
  {
    step: "01",
    title: "Create Project",
    desc: "Set up your work area with satellite imagery, define zones, and configure project settings.",
    icon: "project",
  },
  {
    step: "02",
    title: "Plan Poles & Spans",
    desc: "Plot poles directly on the map, draw cable spans, and define infrastructure routes.",
    icon: "map",
  },
  {
    step: "03",
    title: "Track Progress",
    desc: "Assign tasks to field teams, monitor installation status, and track real-time updates.",
    icon: "track",
  },
  {
    step: "04",
    title: "Generate Reports",
    desc: "Export project data, progress reports, and documentation for stakeholders.",
    icon: "report",
  },
];

// Feature Comparison
const COMPARISON_DATA = [
  {
    feature: "Primary Purpose",
    asbuilt: "Analyze existing as-built plans",
    polemaster: "Plan & manage new infrastructure",
  },
  {
    feature: "Input Required",
    asbuilt: "DXF/PDF drawings",
    polemaster: "No files needed — start fresh",
  },
  {
    feature: "AI-Powered OCR",
    asbuilt: "Yes — TrOCR detection",
    polemaster: "Not applicable",
  },
  {
    feature: "Interactive Maps",
    asbuilt: "DXF-based canvas viewer",
    polemaster: "Satellite imagery with pins",
  },
  {
    feature: "Team Collaboration",
    asbuilt: "Single user workflow",
    polemaster: "Multi-user with assignments",
  },
  {
    feature: "Output Format",
    asbuilt: "Excel workbooks & PDF reports",
    polemaster: "Project reports & exports",
  },
  {
    feature: "Best For",
    asbuilt: "Processing completed surveys",
    polemaster: "Planning new deployments",
  },
];

// Use Cases
const USE_CASES = [
  {
    scenario: "Field Survey Complete",
    description: "You have CAD files from a completed field survey that need to be digitized and analyzed.",
    tool: "asbuilt",
    action: "Upload to AsBuiltIQ",
  },
  {
    scenario: "Starting New Project",
    description: "Planning telecom infrastructure from scratch without existing documentation.",
    tool: "polemaster",
    action: "Open Pole Master",
  },
  {
    scenario: "Audit Existing Infrastructure",
    description: "Need to extract data from legacy paper plans or old DXF files for inventory.",
    tool: "asbuilt",
    action: "Upload to AsBuiltIQ",
  },
  {
    scenario: "Expansion Planning",
    description: "Adding new poles and cable spans to extend an existing network coverage area.",
    tool: "polemaster",
    action: "Open Pole Master",
  },
];

// FAQ Data
const FAQ_DATA = [
  {
    q: "What's the difference between AsBuiltIQ and Pole Master?",
    a: "AsBuiltIQ is designed for analyzing existing as-built plans — it uses AI-powered OCR to automatically detect strand lengths, pole IDs, and equipment from your CAD drawings. Pole Master is for planning and managing new infrastructure projects from scratch, with satellite-based mapping and team collaboration features.",
  },
  {
    q: "What file formats does AsBuiltIQ support?",
    a: "AsBuiltIQ supports DXF files natively. PDF files can also be uploaded and will be automatically converted to DXF format for processing. The system handles files with 100k+ entities and preserves all layer information.",
  },
  {
    q: "How accurate is the OCR detection?",
    a: "Our TrOCR model achieves 99% accuracy on printed pole IDs and strand length labels. The system uses a two-pass strategy: fast-accept at ≥92% confidence, then full 8-angle rotation sweep for uncertain readings. Low-confidence results are surfaced in a review queue for human verification.",
  },
  {
    q: "Can multiple team members use Pole Master simultaneously?",
    a: "Yes! Pole Master supports multi-user collaboration with role-based access. Project managers can assign tasks to field teams, track progress in real-time, and all changes sync automatically across all connected users.",
  },
  {
    q: "Is my data secure?",
    a: "Absolutely. All data is encrypted in transit and at rest. Your CAD files and project data are stored securely and are only accessible to authorized users within your organization. We never share your data with third parties.",
  },
  {
    q: "Can I export data from both systems?",
    a: "Yes. AsBuiltIQ exports to Excel workbooks with full detail sheets (including confidence scores) and summary reports. Pole Master generates project reports, progress summaries, and can export data for integration with other systems.",
  },
];

// Stats
const STATS = [
  { value: "99%", label: "OCR Accuracy", sublabel: "on printed pole IDs" },
  { value: "8×", label: "Faster", sublabel: "than manual extraction" },
  { value: "500+", label: "Projects", sublabel: "processed to date" },
  { value: "24/7", label: "Access", sublabel: "cloud-based platform" },
];

// ─── Chatbot Rules ────────────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}
interface ChatRule {
  keywords: string[];
  response: string;
}

const PORTAL_CHAT_RULES: ChatRule[] = [
  // ─── Greetings ───
  {
    keywords: ["hello", "hi", "hey", "howdy", "greetings", "good morning", "good afternoon", "sup", "yo"],
    response:
      "Hey there! 👋 I'm the TelcoVantage assistant. I can help you learn about our two powerful tools:\n\n• **AsBuiltIQ** — AI-powered CAD drawing analysis\n• **Pole Master** — Infrastructure planning & management\n\nWhat would you like to know?",
  },
  // ─── Decision Help ───
  {
    keywords: ["which tool", "which one", "what should i use", "recommend", "suggestion", "choose", "decide", "don't know which", "unsure"],
    response:
      "Great question! Here's a quick guide:\n\n📄 **Have existing CAD plans?**\n→ Use **AsBuiltIQ** to extract data automatically\n\n🗺️ **Starting from scratch?**\n→ Use **Pole Master** to plan new infrastructure\n\nScroll up to the \"Do you have an as-built plan?\" section and click YES or NO to get started!",
  },
  {
    keywords: ["have a plan", "have plans", "have drawings", "have cad", "have dxf", "existing plan", "completed survey"],
    response:
      "Perfect! Since you have existing plans, **AsBuiltIQ** is your tool. It will:\n\n• Auto-detect strand lengths with TrOCR\n• Extract pole IDs from your drawings\n• Identify equipment (nodes, amps, taps)\n• Export everything to Excel\n\nClick the green \"Yes, I have a plan\" card above to get started!",
  },
  {
    keywords: ["no plan", "don't have", "no drawings", "starting fresh", "new project", "from scratch", "planning new"],
    response:
      "No problem! **Pole Master** is built exactly for this. You can:\n\n• Create projects on satellite imagery\n• Plot poles and draw cable spans\n• Assign tasks to field teams\n• Track progress in real-time\n\nClick the amber \"No, I need to create one\" card above to get started!",
  },
  // ─── General Overview ───
  {
    keywords: ["what is telcovantage", "telcovantage", "about", "overview", "explain", "tell me about", "platform"],
    response:
      "TelcoVantage is a comprehensive telecom infrastructure platform with two integrated tools:\n\n🟢 **AsBuiltIQ** — Upload DXF/PDF files and let AI extract strand lengths, pole IDs, and equipment automatically\n\n🟠 **Pole Master** — Plan new infrastructure on satellite maps, manage field teams, and track progress\n\nBoth tools are designed for telecom engineers to work faster and more accurately.",
  },
  // ─── AsBuiltIQ Questions ───
  {
    keywords: ["asbuiltiq", "as built", "as-built", "asbuilt"],
    response:
      "**AsBuiltIQ** is our AI-powered CAD drawing analysis tool.\n\nIt automatically processes DXF/PDF drawings to:\n• Read strand line length values\n• Identify pole ID labels\n• Detect equipment (nodes, amps, taps)\n• Export everything to Excel\n\nTypical processing time: under 2 minutes for most drawings.",
  },
  {
    keywords: ["upload", "file", "dxf", "pdf", "format", "supported", "import"],
    response:
      "AsBuiltIQ accepts:\n\n• **.dxf** — Processed directly, all layers parsed\n• **.pdf** — Auto-converted to DXF (requires AutoCAD 2022+)\n\nDrag & drop or browse to upload. Files are cached so you don't re-run OCR on revisit.",
  },
  {
    keywords: ["strand", "ocr", "digit", "length", "number", "reading", "confidence", "accuracy", "handwritten"],
    response:
      "Strand length detection uses TrOCR (Microsoft's handwritten model).\n\n• All crops batched into a single OCR pass for speed\n• Pass 1: fast-accept at ≥92% confidence\n• Pass 2: uncertain crops get a full 4-rotation sweep\n• Low confidence readings flagged for review\n\nOverall accuracy: ~99% on clear drawings.",
  },
  {
    keywords: ["pole", "pole id", "pole label", "pole tag", "identifier"],
    response:
      "Pole ID recognition uses TrOCR's printed text model.\n\n• 8-angle sweep: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°\n• Character confusion auto-correction: T/1/l/I/7\n• Results shown with crop previews\n• Rename any pole inline — flows into Excel export\n\nAuto-scan runs on file load.",
  },
  {
    keywords: ["equipment", "node", "amplifier", "amp", "extender", "tap", "splitter", "shape", "hexagon", "detect"],
    response:
      "AsBuiltIQ equipment detection finds:\n\n🔵 Nodes — tall rectangles\n🟠 Amplifiers — wide rectangles\n🔺 Line Extenders — triangles\n🔷 2-Way Taps — circles\n🟩 4-Way Taps — squares\n⬡ 8-Way Taps — hexagons\n\nUses polygon cycle detection on DXF segments.",
  },
  {
    keywords: ["viewer", "view", "map", "canvas", "layer", "zoom", "pan", "visual"],
    response:
      "The DXF Viewer gives you a full interactive canvas:\n\n• Toggle individual layers on/off\n• Zoom & pan with mouse wheel and drag\n• Click cable spans to select and tag status\n• Split or merge spans by double-clicking\n• Connect poles to cable spans\n• Export current view to PDF",
  },
  {
    keywords: ["export", "excel", "xlsx", "download", "report", "save", "output"],
    response:
      "Export options:\n\n**Excel (.xlsx)** from AsBuiltIQ:\n• Sheet 1: Full detail — Digit ID, value, confidence %, coordinates\n• Sheet 2: Pole names summary with total count\n\n**PDF Report** from DXF Viewer:\n• Full drawing image with status overlays\n• Tagged cable spans with length calculations\n\n**Pole Master exports:**\n• Project reports & progress summaries",
  },
  {
    keywords: ["review", "correct", "correction", "wrong", "fix", "uncertain", "manual", "edit"],
    response:
      "Low-confidence OCR readings are flagged automatically.\n\n**OCR Review tab:**\n• Queue with crop previews\n• Accept as-is, or type correct value\n• Enter to accept, Tab to skip\n\n**Pole IDs tab:**\n• Click any pole row to expand\n• Type correct name and press Save",
  },
  // ─── Pole Master Questions ───
  {
    keywords: ["pole master", "polemaster", "planner", "planning tool"],
    response:
      "**Pole Master** is our infrastructure planning and management tool.\n\nFeatures:\n• Create projects on satellite imagery\n• Plot poles and draw cable spans visually\n• Assign tasks to field teams\n• Track installation progress in real-time\n• Generate project reports\n\nPerfect for planning new telecom deployments from scratch.",
  },
  {
    keywords: ["satellite", "imagery", "map", "google", "aerial"],
    response:
      "Pole Master uses satellite imagery for visual planning:\n\n• High-resolution aerial views\n• Plot poles directly on the map\n• Draw cable routes between points\n• Define project zones and areas\n• Works anywhere with satellite coverage",
  },
  {
    keywords: ["team", "collaboration", "assign", "task", "field", "crew", "multi-user"],
    response:
      "Pole Master supports full team collaboration:\n\n• Multi-user access with role permissions\n• Assign tasks to field crews\n• Real-time status updates\n• Track who completed what\n• All changes sync automatically\n\nGreat for managing distributed field teams.",
  },
  {
    keywords: ["progress", "track", "status", "monitor", "dashboard"],
    response:
      "Pole Master progress tracking:\n\n• Visual dashboard with project status\n• Track poles installed vs. planned\n• Monitor cable span completion\n• Real-time updates from field teams\n• Historical progress charts",
  },
  {
    keywords: ["create project", "new project", "setup", "start project", "begin"],
    response:
      "Starting a new Pole Master project:\n\n1️⃣ Click \"Open Pole Master\" or choose the amber card\n2️⃣ Create a new project and name it\n3️⃣ Navigate to your work area on the map\n4️⃣ Start plotting poles and drawing spans\n5️⃣ Assign tasks to team members\n\nYour project auto-saves as you work.",
  },
  // ─── General/Technical ───
  {
    keywords: ["tech", "stack", "technology", "flask", "next", "python", "react", "model", "trocr", "ai", "machine learning"],
    response:
      "Tech stack:\n\n**Backend** — Python/Flask on Render\n• HuggingFace TrOCR models\n• ezdxf for DXF parsing\n• OpenCV & PIL for image processing\n\n**Frontend** — Next.js/TypeScript on Vercel\n• Canvas-based DXF renderer\n• Tailwind CSS v4\n• React 19",
  },
  {
    keywords: ["fast", "speed", "slow", "performance", "how long", "time", "quick"],
    response:
      "Speed highlights:\n\n**AsBuiltIQ:**\n• 8× faster than manual extraction\n• All OCR batched in one inference\n• Typical drawing: under 2 minutes\n• Cached files skip re-processing\n\n**Pole Master:**\n• Real-time map interactions\n• Instant sync across team members",
  },
  {
    keywords: ["price", "pricing", "cost", "free", "paid", "subscription", "plan", "license"],
    response:
      "For pricing and licensing information, please contact the TelcoVantage team directly. Both AsBuiltIQ and Pole Master are designed for enterprise telecom infrastructure workflows.",
  },
  {
    keywords: ["security", "secure", "data", "privacy", "safe", "encrypt"],
    response:
      "Your data is secure:\n\n• All data encrypted in transit and at rest\n• Files stored securely, accessible only to authorized users\n• No data sharing with third parties\n• Role-based access controls\n• Regular security audits",
  },
  {
    keywords: ["contact", "support", "help", "issue", "bug", "problem", "feedback"],
    response:
      "Need help?\n\n• Use the built-in review tools for OCR issues\n• Check that DXF layers follow standard naming\n• For persistent issues, reach out to the TelcoVantage team\n\nIs there a specific issue I can help troubleshoot?",
  },
  // ─── Closers ───
  {
    keywords: ["thank", "thanks", "thx", "appreciate", "great", "awesome", "perfect", "helpful"],
    response:
      "Happy to help! 😊 If you have more questions, just ask. Ready to get started? Scroll up and choose your tool!",
  },
  {
    keywords: ["bye", "goodbye", "see you", "later", "ciao", "done", "exit"],
    response:
      "Goodbye! Feel free to come back anytime. Good luck with your telecom projects! 👋",
  },
];

const PORTAL_FALLBACK =
  "I'm best at answering questions about TelcoVantage tools. Try asking about:\n\n• Which tool should I use?\n• How does AsBuiltIQ work?\n• What is Pole Master?\n• Uploading DXF files\n• Team collaboration features\n\nWhat would you like to know?";

const PORTAL_QUICK_REPLIES = [
  "Which tool should I use?",
  "What is AsBuiltIQ?",
  "What is Pole Master?",
  "How do I get started?",
];

function getPortalResponse(text: string): string {
  const lower = text.toLowerCase();
  for (const rule of PORTAL_CHAT_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.response;
  }
  return PORTAL_FALLBACK;
}

/**
 * Simple markdown formatter for chat messages.
 * Supports: **bold**, newlines, and preserves bullet points/emojis.
 */
function formatChatMessage(text: string): string {
  return text
    // Escape HTML to prevent XSS
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold: **text** → <strong>text</strong>
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-[#1ed27a] font-semibold">$1</strong>')
    // Newlines → <br>
    .replace(/\n/g, "<br>");
}

/**
 * Redirect to Pole Master dashboard with token.
 * The dashboard frontend should read the token from the URL and store it.
 */
function redirectToPoleMaster(token: string) {
  // Open dashboard with token in URL - the dashboard JS should read and store it
  window.open(`${POLE_MASTER_URL}?auth_token=${token}`, "_blank");
}

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

type SelectedTool = "asbuilt" | "polemaster" | null;

// ══════════════════════════════════════════════════════════════════════════════
// AMBIENT BACKGROUND
// ══════════════════════════════════════════════════════════════════════════════

function AmbientBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Base background */}
      <div className="absolute inset-0" style={{ background: COLORS.background }} />

      {/* Floating orbs */}
      <div
        className="absolute rounded-full"
        style={{
          width: 900,
          height: 700,
          top: -200,
          left: "50%",
          background: "radial-gradient(ellipse, rgba(0,112,74,0.28) 0%, transparent 70%)",
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
          background: "radial-gradient(ellipse, rgba(0,80,50,0.20) 0%, transparent 70%)",
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
          background: "radial-gradient(ellipse, rgba(30,210,122,0.12) 0%, transparent 70%)",
          filter: "blur(100px)",
          animation: "floatC 14s ease-in-out infinite",
        }}
      />
      {/* Pole Master accent orb */}
      <div
        className="absolute rounded-full"
        style={{
          width: 400,
          height: 400,
          bottom: "10%",
          right: "20%",
          background: "radial-gradient(ellipse, rgba(251,191,36,0.08) 0%, transparent 70%)",
          filter: "blur(100px)",
          animation: "floatB 16s ease-in-out infinite",
        }}
      />

      {/* Grid overlay */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,112,74,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,112,74,0.04) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)",
        }}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

function Navigation({
  onSignInClick,
  isLoggedIn,
  userName,
  onLogout,
}: {
  onSignInClick: () => void;
  isLoggedIn: boolean;
  userName?: string;
  onLogout: () => void;
}) {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <nav
      className="sticky top-0 z-[100] flex items-center justify-between px-6 md:px-8 h-[68px] backdrop-blur-xl border-b"
      style={{
        background: "rgba(2,32,15,0.85)",
        borderColor: COLORS.border,
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${COLORS.asbuiltDark}, ${COLORS.asbuiltAccent})`,
            boxShadow: `0 0 16px rgba(0,112,74,0.5)`,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="1.5" fill="none" />
            <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
        <span
          className="font-bold text-lg"
          style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}
        >
          TelcoVantage
        </span>
      </div>

      {/* Links - Hidden on mobile */}
      <div className="hidden md:flex items-center gap-8">
        {[
          { id: "workflow", label: "Workflow" },
          { id: "compare", label: "Compare" },
          { id: "use-cases", label: "Use Cases" },
          { id: "faq", label: "FAQ" },
        ].map((link) => (
          <button
            key={link.id}
            onClick={() => scrollTo(link.id)}
            className="text-sm font-medium transition-colors hover:text-white"
            style={{ color: COLORS.textSecondary, background: "none", border: "none", cursor: "pointer" }}
          >
            {link.label}
          </button>
        ))}
      </div>

      {/* Auth */}
      <div className="flex items-center gap-3">
        {isLoggedIn ? (
          <>
            <span className="hidden sm:block text-xs font-mono" style={{ color: COLORS.textSecondary }}>
              {userName}
            </span>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-red-500/10 hover:text-red-400"
              style={{ color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <button
            onClick={onSignInClick}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:-translate-y-px"
            style={{
              background: COLORS.asbuiltDark,
              boxShadow: `0 0 0 1px rgba(0,160,96,0.4), 0 4px 14px rgba(0,112,74,0.35)`,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#00a060";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = COLORS.asbuiltDark;
            }}
          >
            Sign In
          </button>
        )}
      </div>
    </nav>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HERO CONTENT (rendered inside BeamsBackground)
// ══════════════════════════════════════════════════════════════════════════════

function HeroContent() {
  const scrollToDecision = () => {
    const el = document.getElementById("decision");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="relative z-[1] min-h-[90vh] flex flex-col items-center justify-center text-center px-6 md:px-8 pt-12 pb-24">
      {/* Badge */}
      <div
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
        style={{
          border: `1px solid rgba(30,210,122,0.25)`,
          background: "rgba(30,210,122,0.07)",
          animation: "fadeUp 0.8s 0.2s ease both",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: COLORS.asbuiltAccent,
            boxShadow: `0 0 8px ${COLORS.asbuiltAccent}`,
            animation: "pulse 2s infinite",
          }}
        />
        <span
          className="font-mono text-xs tracking-widest uppercase"
          style={{ color: COLORS.asbuiltAccent }}
        >
          TelcoVantage Philippines Services Inc.
        </span>
      </div>

      {/* Headline */}
      <h1
        className="max-w-[1000px] font-bold leading-[1.08] tracking-tight mb-6"
        style={{
          fontFamily: "'Libre Baskerville', serif",
          fontSize: "clamp(2.4rem, 6vw, 5rem)",
          color: COLORS.textPrimary,
          animation: "fadeUp 0.8s 0.35s ease both",
        }}
      >
        Two Powerful Tools for{" "}
        <span
          style={{
            background: `linear-gradient(135deg, ${COLORS.asbuiltAccent}, #00cc77, #00a060)`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Telecom Infrastructure
        </span>
      </h1>

      {/* Subtitle */}
      <p
        className="max-w-[640px] leading-relaxed mb-12"
        style={{
          fontSize: "clamp(1rem, 2vw, 1.25rem)",
          color: COLORS.textSecondary,
          animation: "fadeUp 0.8s 0.5s ease both",
        }}
      >
        Whether you&apos;re analyzing existing as-built CAD drawings or planning new pole infrastructure
        from scratch — we&apos;ve got you covered with AI-powered precision.
      </p>

      {/* CTA */}
      <div
        className="flex flex-col sm:flex-row items-center gap-4"
        style={{ animation: "fadeUp 0.8s 0.65s ease both" }}
      >
        <button
          onClick={scrollToDecision}
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-base font-semibold text-white transition-all hover:-translate-y-1 active:scale-[0.98]"
          style={{
            background: COLORS.asbuiltDark,
            boxShadow: `0 0 0 1px rgba(0,160,96,0.5), 0 4px 16px rgba(0,112,74,0.4)`,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.background = "#00a060";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = COLORS.asbuiltDark;
          }}
        >
          Get Started
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </button>
        <a
          href="#workflow"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" });
          }}
          className="inline-flex items-center gap-2 px-7 py-4 rounded-xl text-base font-medium transition-all hover:-translate-y-0.5"
          style={{
            color: COLORS.textSecondary,
            border: `1px solid ${COLORS.border}`,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          See how it works
        </a>
      </div>

      {/* Scroll indicator */}
      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        style={{ animation: "fadeUp 1s 1s ease both" }}
      >
        <span className="text-xs font-mono tracking-wider uppercase" style={{ color: COLORS.textSecondary }}>
          Scroll
        </span>
        <div
          className="w-6 h-10 rounded-full flex items-start justify-center pt-2"
          style={{ border: `1px solid ${COLORS.border}` }}
        >
          <div
            className="w-1 h-2 rounded-full"
            style={{
              background: COLORS.asbuiltAccent,
              animation: "scrollBounce 1.5s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DECISION PROMPT
// ══════════════════════════════════════════════════════════════════════════════

function DecisionPrompt({
  onSelect,
  isLoggedIn,
  token,
}: {
  onSelect: (tool: SelectedTool) => void;
  isLoggedIn: boolean;
  token: string | null;
}) {
  const [hoveredCard, setHoveredCard] = useState<"yes" | "no" | null>(null);

  const handleYesClick = () => {
    if (isLoggedIn) {
      window.location.assign(ASBUILT_URL);
    } else {
      onSelect("asbuilt");
    }
  };

  const handleNoClick = () => {
    if (isLoggedIn && token) {
      // POST token to ngrok server for session establishment, then redirect
      redirectToPoleMaster(token);
    } else {
      onSelect("polemaster");
    }
  };

  return (
    <section id="decision" className="relative z-[1] py-24 px-6 md:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <span
            className="inline-block font-mono text-xs tracking-widest uppercase mb-4"
            style={{ color: COLORS.asbuiltAccent }}
          >
            Quick Start
          </span>
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}
          >
            Do you have an as-built plan?
          </h2>
          <p className="max-w-lg mx-auto" style={{ color: COLORS.textSecondary }}>
            Choose the right tool for your workflow based on what you&apos;re starting with.
          </p>
        </div>

        {/* Decision cards */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* YES Card - AsBuiltIQ */}
          <button
            onClick={handleYesClick}
            onMouseEnter={() => setHoveredCard("yes")}
            onMouseLeave={() => setHoveredCard(null)}
            className="relative group text-left p-8 rounded-2xl border transition-all duration-300 overflow-hidden"
            style={{
              background: hoveredCard === "yes" ? COLORS.cardBgHover : COLORS.cardBg,
              borderColor: hoveredCard === "yes" ? `${COLORS.asbuiltAccent}40` : COLORS.border,
              transform: hoveredCard === "yes" ? "translateY(-4px)" : "translateY(0)",
              boxShadow: hoveredCard === "yes" ? `0 20px 40px -10px rgba(30,210,122,0.2)` : "none",
            }}
          >
            {/* Top accent line */}
            <div
              className="absolute top-0 left-0 right-0 h-1 transition-opacity duration-300"
              style={{
                background: `linear-gradient(to right, transparent, ${COLORS.asbuiltAccent}, transparent)`,
                opacity: hoveredCard === "yes" ? 1 : 0.3,
              }}
            />

            {/* Icon */}
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 transition-all duration-300"
              style={{
                background: `${COLORS.asbuiltAccent}15`,
                border: `1px solid ${COLORS.asbuiltAccent}30`,
                boxShadow: hoveredCard === "yes" ? `0 0 24px ${COLORS.asbuiltAccent}30` : "none",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.asbuiltAccent} strokeWidth="1.5">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
            </div>

            {/* Content */}
            <div className="mb-6">
              <span
                className="text-lg font-bold block mb-1"
                style={{ color: COLORS.asbuiltAccent }}
              >
                YES — I have plans
              </span>
              <h3
                className="text-2xl font-bold mb-3"
                style={{ fontFamily: "'DM Sans', sans-serif", color: COLORS.textPrimary }}
              >
                AsBuiltIQ
              </h3>
              <p style={{ color: COLORS.textSecondary, lineHeight: 1.7 }}>
                Upload your DXF/PDF drawings and let AI automatically detect strand lengths,
                pole IDs, and equipment — then export to Excel.
              </p>
            </div>

            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono tracking-wider"
              style={{
                background: `${COLORS.asbuiltAccent}10`,
                border: `1px solid ${COLORS.asbuiltAccent}25`,
                color: COLORS.asbuiltAccent,
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: COLORS.asbuiltAccent, animation: "pulse 2s infinite" }}
              />
              AI-POWERED OCR
            </div>

            {/* Arrow */}
            <div
              className="absolute bottom-8 right-8 transition-all duration-300"
              style={{
                opacity: hoveredCard === "yes" ? 1 : 0.3,
                transform: hoveredCard === "yes" ? "translateX(4px)" : "translateX(0)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.asbuiltAccent} strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* NO Card - Pole Master */}
          <button
            onClick={handleNoClick}
            onMouseEnter={() => setHoveredCard("no")}
            onMouseLeave={() => setHoveredCard(null)}
            className="relative group text-left p-8 rounded-2xl border transition-all duration-300 overflow-hidden"
            style={{
              background: hoveredCard === "no" ? COLORS.cardBgHover : COLORS.cardBg,
              borderColor: hoveredCard === "no" ? `${COLORS.poleMasterAccent}40` : COLORS.border,
              transform: hoveredCard === "no" ? "translateY(-4px)" : "translateY(0)",
              boxShadow: hoveredCard === "no" ? `0 20px 40px -10px rgba(251,191,36,0.15)` : "none",
            }}
          >
            {/* Top accent line */}
            <div
              className="absolute top-0 left-0 right-0 h-1 transition-opacity duration-300"
              style={{
                background: `linear-gradient(to right, transparent, ${COLORS.poleMasterAccent}, transparent)`,
                opacity: hoveredCard === "no" ? 1 : 0.3,
              }}
            />

            {/* Icon */}
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 transition-all duration-300"
              style={{
                background: `${COLORS.poleMasterAccent}15`,
                border: `1px solid ${COLORS.poleMasterAccent}30`,
                boxShadow: hoveredCard === "no" ? `0 0 24px ${COLORS.poleMasterAccent}25` : "none",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.poleMasterAccent} strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>

            {/* Content */}
            <div className="mb-6">
              <span
                className="text-lg font-bold block mb-1"
                style={{ color: COLORS.poleMasterAccent }}
              >
                NO — Starting fresh
              </span>
              <h3
                className="text-2xl font-bold mb-3"
                style={{ fontFamily: "'DM Sans', sans-serif", color: COLORS.textPrimary }}
              >
                Pole Master
              </h3>
              <p style={{ color: COLORS.textSecondary, lineHeight: 1.7 }}>
                Plan new infrastructure from scratch using satellite imagery. Plot poles,
                draw cable spans, assign teams, and track progress.
              </p>
            </div>

            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono tracking-wider"
              style={{
                background: `${COLORS.poleMasterAccent}10`,
                border: `1px solid ${COLORS.poleMasterAccent}25`,
                color: COLORS.poleMasterAccent,
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: COLORS.poleMasterAccent, animation: "pulse 2s infinite" }}
              />
              PROJECT PLANNING
            </div>

            {/* Arrow */}
            <div
              className="absolute bottom-8 right-8 transition-all duration-300"
              style={{
                opacity: hoveredCard === "no" ? 1 : 0.3,
                transform: hoveredCard === "no" ? "translateX(4px)" : "translateX(0)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.poleMasterAccent} strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WORKFLOW ICON COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function WorkflowIcon({ icon, color }: { icon: string; color: string }) {
  const icons: Record<string, React.ReactNode> = {
    upload: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
      </svg>
    ),
    scan: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
        <rect x="7" y="7" width="10" height="10" rx="1" />
      </svg>
    ),
    review: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    export: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
      </svg>
    ),
    project: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    ),
    map: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    track: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    report: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h2v4H8zM14 11h2v6h-2z" />
      </svg>
    ),
  };

  return icons[icon] || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// WORKFLOW SECTION
// ══════════════════════════════════════════════════════════════════════════════

function WorkflowSection() {
  return (
    <section id="workflow" className="relative z-[1] py-24 px-6 md:px-8" style={{ background: "rgba(0,0,0,0.2)" }}>
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <span
            className="inline-block font-mono text-xs tracking-widest uppercase mb-4"
            style={{ color: COLORS.asbuiltAccent }}
          >
            How It Works
          </span>
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}
          >
            Two Distinct Workflows
          </h2>
          <p className="max-w-lg mx-auto" style={{ color: COLORS.textSecondary }}>
            Each tool is optimized for its specific use case with streamlined, intuitive processes.
          </p>
        </div>

        {/* Dual workflow columns */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* AsBuiltIQ Workflow */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: `${COLORS.asbuiltAccent}15`, border: `1px solid ${COLORS.asbuiltAccent}30` }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.asbuiltAccent} strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 9h6M9 12h6M9 15h4" />
                </svg>
              </div>
              <h3 className="text-xl font-bold" style={{ color: COLORS.asbuiltAccent }}>
                AsBuiltIQ
              </h3>
            </div>

            <div className="space-y-4">
              {ASBUILT_WORKFLOW.map((item, idx) => (
                <div
                  key={idx}
                  className="relative p-5 rounded-xl border transition-all duration-200 hover:border-opacity-50"
                  style={{
                    background: COLORS.cardBg,
                    borderColor: `${COLORS.asbuiltAccent}20`,
                  }}
                >
                  <div className="flex gap-4">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${COLORS.asbuiltAccent}10` }}
                    >
                      <WorkflowIcon icon={item.icon} color={COLORS.asbuiltAccent} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-xs font-mono tracking-wider"
                          style={{ color: COLORS.asbuiltAccent }}
                        >
                          {item.step}
                        </span>
                        <span className="font-semibold" style={{ color: COLORS.textPrimary }}>
                          {item.title}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pole Master Workflow */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: `${COLORS.poleMasterAccent}15`, border: `1px solid ${COLORS.poleMasterAccent}30` }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.poleMasterAccent} strokeWidth="1.5">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h3 className="text-xl font-bold" style={{ color: COLORS.poleMasterAccent }}>
                Pole Master
              </h3>
            </div>

            <div className="space-y-4">
              {POLE_MASTER_WORKFLOW.map((item, idx) => (
                <div
                  key={idx}
                  className="relative p-5 rounded-xl border transition-all duration-200 hover:border-opacity-50"
                  style={{
                    background: COLORS.cardBg,
                    borderColor: `${COLORS.poleMasterAccent}20`,
                  }}
                >
                  <div className="flex gap-4">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${COLORS.poleMasterAccent}10` }}
                    >
                      <WorkflowIcon icon={item.icon} color={COLORS.poleMasterAccent} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-xs font-mono tracking-wider"
                          style={{ color: COLORS.poleMasterAccent }}
                        >
                          {item.step}
                        </span>
                        <span className="font-semibold" style={{ color: COLORS.textPrimary }}>
                          {item.title}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STATS SECTION
// ══════════════════════════════════════════════════════════════════════════════

function StatsSection() {
  return (
    <section className="relative z-[1] py-16 px-6 md:px-8">
      <div className="max-w-5xl mx-auto">
        <div
          className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border overflow-hidden"
          style={{ borderColor: COLORS.border, gap: "1px", background: COLORS.border }}
        >
          {STATS.map((stat, idx) => (
            <div
              key={idx}
              className="px-6 py-8 text-center transition-colors"
              style={{ background: COLORS.cardBg }}
            >
              <div
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{
                  fontFamily: "'Libre Baskerville', serif",
                  background: `linear-gradient(135deg, ${COLORS.asbuiltAccent}, #00a060)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {stat.value}
              </div>
              <div className="font-semibold mb-1" style={{ color: COLORS.textPrimary }}>
                {stat.label}
              </div>
              <div className="text-xs" style={{ color: COLORS.textSecondary }}>
                {stat.sublabel}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPARISON SECTION
// ══════════════════════════════════════════════════════════════════════════════

function ComparisonSection() {
  return (
    <section id="compare" className="relative z-[1] py-24 px-6 md:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <span
            className="inline-block font-mono text-xs tracking-widest uppercase mb-4"
            style={{ color: COLORS.asbuiltAccent }}
          >
            Comparison
          </span>
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}
          >
            Feature Comparison
          </h2>
          <p className="max-w-lg mx-auto" style={{ color: COLORS.textSecondary }}>
            See how each tool addresses different aspects of telecom infrastructure work.
          </p>
        </div>

        {/* Comparison table */}
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: COLORS.border, background: COLORS.cardBg }}
        >
          {/* Header row */}
          <div
            className="grid grid-cols-3 border-b"
            style={{ borderColor: COLORS.border, background: "rgba(0,0,0,0.3)" }}
          >
            <div className="p-4 font-mono text-xs tracking-wider uppercase" style={{ color: COLORS.textSecondary }}>
              Feature
            </div>
            <div className="p-4 font-semibold text-center" style={{ color: COLORS.asbuiltAccent }}>
              AsBuiltIQ
            </div>
            <div className="p-4 font-semibold text-center" style={{ color: COLORS.poleMasterAccent }}>
              Pole Master
            </div>
          </div>

          {/* Data rows */}
          {COMPARISON_DATA.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-3 border-b last:border-b-0 transition-colors hover:bg-white/[0.02]"
              style={{ borderColor: COLORS.border }}
            >
              <div className="p-4 font-medium" style={{ color: COLORS.textPrimary }}>
                {row.feature}
              </div>
              <div className="p-4 text-center text-sm" style={{ color: COLORS.textSecondary }}>
                {row.asbuilt}
              </div>
              <div className="p-4 text-center text-sm" style={{ color: COLORS.textSecondary }}>
                {row.polemaster}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// USE CASES SECTION
// ══════════════════════════════════════════════════════════════════════════════

function UseCasesSection({
  onToolSelect,
  isLoggedIn,
  token,
}: {
  onToolSelect: (tool: SelectedTool) => void;
  isLoggedIn: boolean;
  token: string | null;
}) {
  const handleClick = (tool: "asbuilt" | "polemaster") => {
    if (isLoggedIn) {
      if (tool === "asbuilt") {
        window.location.assign(ASBUILT_URL);
      } else if (token) {
        window.open(`${POLE_MASTER_URL}?token=${token}`, "_blank");
      }
    } else {
      onToolSelect(tool);
    }
  };

  return (
    <section id="use-cases" className="relative z-[1] py-24 px-6 md:px-8" style={{ background: "rgba(0,0,0,0.2)" }}>
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <span
            className="inline-block font-mono text-xs tracking-widest uppercase mb-4"
            style={{ color: COLORS.asbuiltAccent }}
          >
            Scenarios
          </span>
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}
          >
            Real-World Use Cases
          </h2>
          <p className="max-w-lg mx-auto" style={{ color: COLORS.textSecondary }}>
            Click a scenario to jump directly to the right tool for the job.
          </p>
        </div>

        {/* Use case cards */}
        <div className="grid sm:grid-cols-2 gap-4">
          {USE_CASES.map((uc, idx) => {
            const isAsbuilt = uc.tool === "asbuilt";
            const accentColor = isAsbuilt ? COLORS.asbuiltAccent : COLORS.poleMasterAccent;

            return (
              <button
                key={idx}
                onClick={() => handleClick(uc.tool as "asbuilt" | "polemaster")}
                className="group relative text-left p-6 rounded-xl border transition-all duration-200 hover:-translate-y-1"
                style={{
                  background: COLORS.cardBg,
                  borderColor: COLORS.border,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="font-semibold mb-2" style={{ color: COLORS.textPrimary }}>
                      {uc.scenario}
                    </h4>
                    <p className="text-sm mb-4" style={{ color: COLORS.textSecondary }}>
                      {uc.description}
                    </p>
                    <span
                      className="inline-flex items-center gap-2 text-xs font-mono tracking-wider"
                      style={{ color: accentColor }}
                    >
                      {uc.action}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="transition-transform group-hover:translate-x-1"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}
                  >
                    {isAsbuilt ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M9 9h6M9 12h6M9 15h4" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FAQ SECTION
// ══════════════════════════════════════════════════════════════════════════════

function FAQSection() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="relative z-[1] py-24 px-6 md:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <span
            className="inline-block font-mono text-xs tracking-widest uppercase mb-4"
            style={{ color: COLORS.asbuiltAccent }}
          >
            Support
          </span>
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}
          >
            Frequently Asked Questions
          </h2>
        </div>

        {/* Accordion */}
        <div className="space-y-3">
          {FAQ_DATA.map((faq, idx) => {
            const isExpanded = expandedIndex === idx;

            return (
              <div
                key={idx}
                className="rounded-xl border overflow-hidden transition-all duration-200"
                style={{
                  borderColor: isExpanded ? `${COLORS.asbuiltAccent}30` : COLORS.border,
                  background: COLORS.cardBg,
                }}
              >
                <button
                  onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span className="font-medium" style={{ color: COLORS.textPrimary }}>
                    {faq.q}
                  </span>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={COLORS.textSecondary}
                    strokeWidth="2"
                    className="flex-shrink-0 transition-transform duration-200"
                    style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div
                  className="overflow-hidden transition-all duration-200"
                  style={{
                    maxHeight: isExpanded ? "500px" : "0px",
                    opacity: isExpanded ? 1 : 0,
                  }}
                >
                  <div
                    className="px-5 pb-5 text-sm leading-relaxed"
                    style={{ color: COLORS.textSecondary }}
                  >
                    {faq.a}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FOOTER
// ══════════════════════════════════════════════════════════════════════════════

function Footer() {
  return (
    <footer
      className="relative z-[1] border-t py-12 px-6 md:px-8"
      style={{ borderColor: COLORS.border, background: "rgba(0,0,0,0.3)" }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${COLORS.asbuiltDark}, ${COLORS.asbuiltAccent})`,
                boxShadow: `0 0 12px rgba(0,112,74,0.4)`,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="1.5" fill="none" />
                <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" fill="none" />
              </svg>
            </div>
            <div>
              <span className="font-bold" style={{ fontFamily: "'Libre Baskerville', serif", color: COLORS.textPrimary }}>
                TelcoVantage
              </span>
              <span className="text-xs block" style={{ color: COLORS.textSecondary }}>
                Philippines Services Inc.
              </span>
            </div>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6 text-sm" style={{ color: COLORS.textSecondary }}>
            <a href="#workflow" className="hover:text-white transition-colors">
              Workflow
            </a>
            <a href="#compare" className="hover:text-white transition-colors">
              Compare
            </a>
            <a href="#use-cases" className="hover:text-white transition-colors">
              Use Cases
            </a>
            <a href="#faq" className="hover:text-white transition-colors">
              FAQ
            </a>
          </div>

          {/* Copyright */}
          <div className="text-xs font-mono" style={{ color: COLORS.textSecondary }}>
            © {new Date().getFullYear()} TelcoVantage
          </div>
        </div>
      </div>
    </footer>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN MODAL
// ══════════════════════════════════════════════════════════════════════════════

function LoginModal({
  isOpen,
  onClose,
  selectedTool,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedTool: SelectedTool;
  onSuccess: (token: string, user: User, tool: SelectedTool) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onClose]);

  // Close on escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
    }
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEmail("");
      setPassword("");
      setError(null);
      setShowPassword(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${NGROK_BASE}/api/v1/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid credentials. Please try again.");
        if (res.status === 403) throw new Error("Your role is not permitted to access this portal.");
        throw new Error(data.message || "Login failed. Please try again.");
      }

      onSuccess(data.token, data.user, selectedTool);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error. Check your connection.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const isAsbuilt = selectedTool === "asbuilt";
  const accentColor = isAsbuilt ? COLORS.asbuiltAccent : COLORS.poleMasterAccent;
  const toolName = isAsbuilt ? "AsBuiltIQ" : "Pole Master";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-md rounded-2xl border overflow-hidden"
        style={{
          background: COLORS.cardBg,
          borderColor: `${accentColor}30`,
          boxShadow: `0 0 60px -20px ${accentColor}30, 0 25px 50px -12px rgba(0,0,0,0.5)`,
          animation: "modalSlideIn 0.3s ease-out",
        }}
      >
        {/* Top accent */}
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{ background: `linear-gradient(to right, transparent, ${accentColor}, transparent)` }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg transition-colors hover:bg-white/10"
          style={{ color: COLORS.textSecondary }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}
            >
              {isAsbuilt ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 9h6M9 12h6M9 15h4" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              )}
            </div>
            <div>
              <div className="font-bold" style={{ color: COLORS.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>
                Sign in to access
              </div>
              <div className="text-sm font-semibold" style={{ color: accentColor }}>
                {toolName}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label
                className="block text-xs font-mono tracking-wider uppercase mb-2"
                style={{ color: COLORS.textSecondary }}
              >
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                required
                placeholder="user@telcovantage.com"
                className="w-full h-12 px-4 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  color: COLORS.textPrimary,
                  border: `1px solid ${focused === "email" ? accentColor : COLORS.border}`,
                  fontFamily: "'DM Mono', monospace",
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label
                className="block text-xs font-mono tracking-wider uppercase mb-2"
                style={{ color: COLORS.textSecondary }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  required
                  placeholder="••••••••••••"
                  className="w-full h-12 px-4 pr-12 rounded-lg text-sm outline-none transition-all"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    color: COLORS.textPrimary,
                    border: `1px solid ${focused === "password" ? accentColor : COLORS.border}`,
                    fontFamily: "'DM Mono', monospace",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors hover:bg-white/10"
                  style={{ color: COLORS.textSecondary }}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg border text-xs"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "#f87171",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-lg font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: loading ? `${accentColor}50` : accentColor,
                boxShadow: loading ? "none" : `0 4px 14px ${accentColor}40`,
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating…
                </span>
              ) : (
                `Sign In to ${toolName} →`
              )}
            </button>
          </form>

          {/* Footer note */}
          <p
            className="text-center text-xs font-mono tracking-wider mt-6"
            style={{ color: COLORS.textSecondary, opacity: 0.5 }}
          >
            ADMIN · PROJECT_MANAGER · EXECUTIVES ONLY
          </p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PORTAL CHATBOT COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function PortalChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hi! I'm the TelcoVantage assistant. 👋\n\nAsk me about AsBuiltIQ, Pole Master, or which tool is right for your needs.",
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
    setTimeout(
      () => {
        setMessages((p) => [
          ...p,
          { role: "assistant", text: getPortalResponse(msg) },
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
        text: "Hi! I'm the TelcoVantage assistant. 👋\n\nAsk me about AsBuiltIQ, Pole Master, or which tool is right for your needs.",
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
        title="Chat with TelcoVantage Assistant"
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div className="text-[0.85rem] font-bold text-[#e8f0eb] leading-tight">
                TelcoVantage Assistant
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
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                )}
                {m.role === "assistant" ? (
                  <div
                    className="max-w-[78%] px-3 py-2.5 text-[0.82rem] leading-relaxed break-words rounded-[14px_14px_14px_4px] bg-[#072b16] border border-white/[0.08] text-[#e8f0eb] shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                    dangerouslySetInnerHTML={{ __html: formatChatMessage(m.text) }}
                  />
                ) : (
                  <div className="max-w-[78%] px-3 py-2.5 text-[0.82rem] leading-relaxed whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] bg-gradient-to-br from-[#00704A] to-[#005c3a] border border-[rgba(0,160,96,0.4)] text-white shadow-[0_2px_8px_rgba(0,112,74,0.25)]">
                    {m.text}
                  </div>
                )}
              </div>
            ))}

            {/* Quick reply chips */}
            {showQuick && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {PORTAL_QUICK_REPLIES.map((qr) => (
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
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
              placeholder="Ask about our tools…"
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

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function PortalPage() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [selectedTool, setSelectedTool] = useState<SelectedTool>(null);

  // Mount and restore session
  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
    const savedToken = localStorage.getItem("tv_portal_token");
    const savedUser = localStorage.getItem("tv_portal_user");
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem("tv_portal_token");
        localStorage.removeItem("tv_portal_user");
      }
    }
  }, []);

  const handleToolSelect = (tool: SelectedTool) => {
    setSelectedTool(tool);
    setShowLoginModal(true);
  };

  const handleSignInClick = () => {
    setSelectedTool(null);
    setShowLoginModal(true);
  };

  const handleLoginSuccess = (newToken: string, newUser: User, tool: SelectedTool) => {
    localStorage.setItem("tv_portal_token", newToken);
    localStorage.setItem("tv_portal_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setShowLoginModal(false);

    // Redirect based on selected tool
    if (tool === "asbuilt") {
      window.location.assign(ASBUILT_URL);
    } else if (tool === "polemaster") {
      // POST token to ngrok server for session establishment
      redirectToPoleMaster(newToken);
    }
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch(`${NGROK_BASE}/api/v1/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "ngrok-skip-browser-warning": "true",
          },
        });
      } catch {}
    }
    localStorage.removeItem("tv_portal_token");
    localStorage.removeItem("tv_portal_user");
    setToken(null);
    setUser(null);
  };

  if (!mounted) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Libre+Baskerville:wght@400;700&display=swap');

        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        
        /* Override global layout styles for portal page */
        body {
          height: auto !important;
          min-height: 100vh !important;
          overflow: auto !important;
          overflow-x: hidden !important;
          background: ${COLORS.background} !important;
        }

        @keyframes floatA {
          0%, 100% { transform: translate(-50%, 0); }
          50% { transform: translate(-48%, -20px); }
        }

        @keyframes floatB {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(15px, 10px); }
        }

        @keyframes floatC {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-10px, -15px); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        @keyframes scrollBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(8px); }
        }

        @keyframes modalSlideIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        className="relative"
        style={{ fontFamily: "'DM Sans', system-ui, sans-serif", color: COLORS.textPrimary }}
      >
        <AmbientBackground />

        <Navigation
          onSignInClick={handleSignInClick}
          isLoggedIn={!!token && !!user}
          userName={user?.name}
          onLogout={handleLogout}
        />

        {/* Hero with Beams Background */}
        <BeamsBackground className="!min-h-[90vh]" intensity="medium">
          <HeroContent />
        </BeamsBackground>

        <DecisionPrompt onSelect={handleToolSelect} isLoggedIn={!!token && !!user} token={token} />
        <WorkflowSection />
        <StatsSection />
        <ComparisonSection />
        <UseCasesSection onToolSelect={handleToolSelect} isLoggedIn={!!token && !!user} token={token} />
        <FAQSection />
        <Footer />

        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          selectedTool={selectedTool}
          onSuccess={handleLoginSuccess}
        />

        <PortalChatbot />
      </div>
    </>
  );
}
