"use client";

import { useState, useEffect, useRef } from "react";
import { BeamsBackground } from "@/components/ui/beams-background";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & DATA
// ══════════════════════════════════════════════════════════════════════════════

const API_BASE_URL =
  process.env.NEXT_PUBLIC_ASBUILT_API_BASE_URL ||
  "https://saddlebrown-wolf-799636.hostingersite.com/api/v1";
const ASBUILT_URL = "/";
const POLE_MASTER_URL = `${API_BASE_URL}/dashboard`;

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



/**
 * Redirect to Pole Master dashboard with token.
 * The dashboard frontend should read the token from the URL and store it.
 */
function redirectToPoleMaster(token: string) {
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
    window.location.assign(ASBUILT_URL);
  };

  const handleNoClick = () => {
    if (isLoggedIn && token) {
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
      const res = await fetch(`${API_BASE_URL}/api/v1/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
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
      redirectToPoleMaster(newToken);
    }
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/v1/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
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

      </div>
    </>
  );
}
