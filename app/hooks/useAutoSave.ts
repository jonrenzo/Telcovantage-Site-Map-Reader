import { useCallback, useRef, useEffect, useState } from 'react'
import { useDatabase } from './useDatabase'
import type { DigitResult, Segment, EquipmentShape, BoundaryPoint, PoleTag } from '../types'
import type { Pole, EquipmentShape as DbEquipmentShape, DxfSegmentData } from '../lib/supabase'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface AutoSaveData {
  results?: DigitResult[]
  segments?: Segment[]
  shapes?: EquipmentShape[]
  boundary?: BoundaryPoint[] | null
  poleTags?: PoleTag[]
  strandLayer?: string
  poleLayer?: string
  equipmentLayers?: string[]
  maskEnabled?: boolean
  ocrDone?: boolean
  equipmentDone?: boolean
  polesDone?: boolean
  // Cable span status data
  cableStatuses?: Record<number, string>
  partialDetails?: Record<number, { recovered?: number }>
}

interface UseAutoSaveOptions {
  sessionId: string | null
  debounceMs?: number
  intervalMs?: number
}

export function useAutoSave(options: UseAutoSaveOptions) {
  const { sessionId, debounceMs = 2000, intervalMs = 30000 } = options
  
  const db = useDatabase()
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Store pending data to save
  const pendingDataRef = useRef<AutoSaveData>({})
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const intervalTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isSavingRef = useRef(false)

  // Perform the actual save
  const performSave = useCallback(async () => {
    if (!sessionId || !db.isConfigured()) return
    if (isSavingRef.current) return
    
    const data = pendingDataRef.current
    if (Object.keys(data).length === 0) return

    isSavingRef.current = true
    setStatus('saving')
    setError(null)

    try {
      // Save config if any config fields are present
      const configFields: (keyof AutoSaveData)[] = [
        'strandLayer', 'poleLayer', 'equipmentLayers', 
        'maskEnabled', 'ocrDone', 'equipmentDone', 'polesDone'
      ]
      const hasConfigChanges = configFields.some(field => field in data)
      
      if (hasConfigChanges) {
        await db.saveSessionConfig(sessionId, {
          strand_layer: data.strandLayer,
          pole_layer: data.poleLayer,
          equipment_layers: data.equipmentLayers,
          mask_enabled: data.maskEnabled,
          ocr_done: data.ocrDone,
          equipment_done: data.equipmentDone,
          poles_done: data.polesDone,
        })
      }

      // Save digit results
      if (data.results && data.results.length > 0) {
        const dbResults = data.results.map(r => ({
          digit_id: r.digit_id,
          value: r.value,
          corrected_value: r.corrected_value,
          confidence: r.confidence,
          needs_review: r.needs_review,
          center_x: r.center_x,
          center_y: r.center_y,
          bbox: r.bbox,
          manual: r.manual || false,
        }))
        await db.saveDigitResults(sessionId, dbResults)
      }

      // Save equipment shapes
      if (data.shapes && data.shapes.length > 0) {
        const dbShapes: DbEquipmentShape[] = data.shapes.map((s, idx) => ({
          id: '',
          session_id: sessionId,
          shape_id: idx,
          kind: s.kind,
          layer: s.layer,
          cx: s.cx,
          cy: s.cy,
          bbox: s.bbox,
        }))
        await db.saveEquipmentShapes(sessionId, dbShapes)
      }

      // Save boundary
      if (data.boundary && data.boundary.length > 0) {
        await db.saveBoundary(sessionId, data.boundary)
      }

      // Save poles
      if (data.poleTags && data.poleTags.length > 0) {
        const dbPoles: Pole[] = data.poleTags.map((p, idx) => ({
          id: '',
          session_id: sessionId,
          pole_id: p.pole_id ?? idx,
          name: p.name,
          corrected_name: null, // Will be set when user corrects
          cx: p.cx,
          cy: p.cy,
          bbox: p.bbox,
          layer: p.layer,
          source: p.source,
          ocr_conf: p.ocr_conf ?? null,
          needs_review: p.needs_review ?? false,
        }))
        await db.savePoles(sessionId, dbPoles)
      }

      // Save DXF segments (segments don't have layer info in current type)
      // We save all segments under a default layer
      if (data.segments && data.segments.length > 0) {
        const segmentData: DxfSegmentData[] = data.segments.map(seg => ({
          x1: seg.x1,
          y1: seg.y1,
          x2: seg.x2,
          y2: seg.y2,
        }))
        await db.saveDxfSegments(sessionId, '_all', segmentData)
      }

      // Save cable span statuses
      if (data.cableStatuses && Object.keys(data.cableStatuses).length > 0) {
        const statusesWithDetails: Record<string, { status: string; partial?: { recovered?: number } }> = {}
        
        for (const [spanIdStr, status] of Object.entries(data.cableStatuses)) {
          const spanId = parseInt(spanIdStr, 10)
          statusesWithDetails[spanIdStr] = {
            status,
            partial: data.partialDetails?.[spanId],
          }
        }
        
        await db.saveCableSpanStatuses(sessionId, statusesWithDetails)
      }

      // Clear pending data after successful save
      pendingDataRef.current = {}
      setStatus('saved')
      setLastSaved(new Date())
      
      console.log('[AutoSave] Save completed successfully')
    } catch (err) {
      console.error('[AutoSave] Save failed:', err)
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      isSavingRef.current = false
    }
  }, [sessionId, db])

  // Queue data for saving with debounce
  const queueSave = useCallback((data: AutoSaveData) => {
    // Merge new data with pending data
    pendingDataRef.current = {
      ...pendingDataRef.current,
      ...data,
    }

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      performSave()
    }, debounceMs)
  }, [debounceMs, performSave])

  // Immediate save (bypass debounce)
  const saveNow = useCallback(async (data?: AutoSaveData) => {
    if (data) {
      pendingDataRef.current = {
        ...pendingDataRef.current,
        ...data,
      }
    }
    
    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    
    await performSave()
  }, [performSave])

  // Set up interval-based auto-save
  useEffect(() => {
    if (!sessionId || intervalMs <= 0) return

    intervalTimerRef.current = setInterval(() => {
      if (Object.keys(pendingDataRef.current).length > 0) {
        performSave()
      }
    }, intervalMs)

    return () => {
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current)
      }
    }
  }, [sessionId, intervalMs, performSave])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current)
      }
    }
  }, [])

  // Save on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (Object.keys(pendingDataRef.current).length > 0 && sessionId) {
        // Use sendBeacon for reliable save on unload
        // Note: This won't work with our current setup, but we can at least try
        performSave()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [sessionId, performSave])

  return {
    status,
    lastSaved,
    error,
    queueSave,
    saveNow,
    hasPendingChanges: Object.keys(pendingDataRef.current).length > 0,
  }
}
