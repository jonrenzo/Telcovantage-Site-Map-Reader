import { useRef, useCallback } from "react";
import type {
  DigitResult,
  Segment,
  EquipmentShape,
  BoundaryPoint,
  PoleTag,
} from "../types";

// ── Per-file cache entry ───────────────────────────────────────────────────
export interface FileCache {
  // OCR pipeline
  results: DigitResult[];
  segments: Segment[];
  // Equipment scan
  shapes: EquipmentShape[];
  boundary: BoundaryPoint[] | null;
  equipmentDone: boolean;
  // Pole scan
  poleTags: PoleTag[];
  poleLayer: string | null;
  poleDone: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function useSessionCache() {
  // Use a ref so cache updates never cause re-renders of page.tsx
  const cacheRef = useRef<Record<string, FileCache>>({});

  const getCache = useCallback((dxfPath: string): FileCache | null => {
    return cacheRef.current[dxfPath] ?? null;
  }, []);

  const setCache = useCallback((dxfPath: string, data: Partial<FileCache>) => {
    const existing = cacheRef.current[dxfPath] ?? {
      results: [],
      segments: [],
      shapes: [],
      boundary: null,
      equipmentDone: false,
      poleTags: [],
      poleLayer: null,
      poleDone: false,
    };
    cacheRef.current[dxfPath] = { ...existing, ...data };
  }, []);

  const hasCache = useCallback((dxfPath: string): boolean => {
    return !!cacheRef.current[dxfPath];
  }, []);

  return { getCache, setCache, hasCache };
}
