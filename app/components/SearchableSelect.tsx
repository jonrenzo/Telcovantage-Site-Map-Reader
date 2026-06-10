"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Option {
  code: string;
  name: string;
}

interface Props {
  label: string;
  value: string; // selected code
  options: Option[];
  onChange: (code: string, option: Option | null) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyHint?: string;
}

export default function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "— Select —",
  disabled = false,
  loading = false,
  emptyHint = "No matches",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.code === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Focus the search box when opening
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const choose = (opt: Option) => {
    onChange(opt.code, opt);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) choose(opt);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>

      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-white text-sm text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:bg-slate-50 disabled:cursor-not-allowed ${
          open ? "border-accent ring-2 ring-accent" : "border-border hover:border-slate-300"
        }`}
      >
        <span className={selected ? "text-text truncate" : "text-muted truncate"}>
          {loading ? "Loading…" : selected ? selected.name : placeholder}
        </span>
        <svg
          className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border bg-surface-2">
            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="w-full pl-8 pr-2 py-1.5 rounded-md border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted">{emptyHint}</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = opt.code === value;
                const isActive = i === activeIndex;
                return (
                  <li key={opt.code}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(opt)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                        isActive ? "bg-accent/10" : ""
                      } ${isSelected ? "text-accent font-semibold" : "text-text"}`}
                    >
                      <span className="truncate">{opt.name}</span>
                      {isSelected && (
                        <svg
                          className="w-4 h-4 shrink-0 text-accent"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
