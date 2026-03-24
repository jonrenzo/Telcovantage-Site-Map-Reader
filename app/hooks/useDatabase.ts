import { useCallback } from 'react'
import { 
  supabase, 
  Project, 
  Session, 
  FullSession, 
  CableSpan, 
  CableSegment, 
  DigitResult, 
  Pole, 
  EquipmentShape,
  BoundaryPoint,
  SessionConfig,
  SessionSummary,
  DxfSegmentData
} from '../lib/supabase'

function throwNotConfigured(): never {
  throw new Error('Supabase not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env')
}

export function useDatabase() {
  const getSb = useCallback(() => {
    if (!supabase) throwNotConfigured()
    return supabase
  }, [])

  // Check if Supabase is configured
  const isConfigured = useCallback(() => {
    return supabase !== null
  }, [])

  const initProject = useCallback(async (dxfPath: string, checksum: string) => {
    const sb = getSb()
    const fileName = dxfPath.split(/[\\\/]/).pop() || 'unknown'

    const { data: existing } = await sb
      .from('projects')
      .select('*')
      .eq('dxf_checksum', checksum)
      .single()

    if (existing) {
      return { project: existing as Project, isNew: false }
    }

    const { data, error } = await sb
      .from('projects')
      .insert({
        dxf_file_name: fileName,
        dxf_checksum: checksum,
        dxf_file_path: dxfPath,
      })
      .select()
      .single()

    if (error) throw error
    return { project: data as Project, isNew: true }
  }, [getSb])

  const getProjects = useCallback(async (): Promise<Project[]> => {
    const sb = getSb()
    const { data, error } = await sb
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data as Project[]) || []
  }, [getSb])

  const createSession = useCallback(async (projectId: string, name: string) => {
    const sb = getSb()
    await sb
      .from('sessions')
      .update({ is_active: false })
      .eq('project_id', projectId)

    const { data, error } = await sb
      .from('sessions')
      .insert({ project_id: projectId, name, is_active: true })
      .select()
      .single()

    if (error) throw error
    return data as Session
  }, [getSb])

  const getSessions = useCallback(async (projectId: string): Promise<Session[]> => {
    const sb = getSb()
    const { data, error } = await sb
      .from('sessions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data as Session[]) || []
  }, [getSb])

  const getActiveSession = useCallback(async (projectId: string): Promise<Session | null> => {
    const sb = getSb()
    const { data, error } = await sb
      .from('sessions')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return data as Session | null
  }, [getSb])

  const getOrCreateSessionForFile = useCallback(async (dxfPath: string): Promise<{ project: Project; session: Session; isNewSession: boolean }> => {
    const sb = getSb()
    const fileName = dxfPath.split(/[\\\/]/).pop() || 'unknown'
    console.log("[DB] getOrCreateSessionForFile called with:", dxfPath)

    // Check if project exists by file path
    const { data: existingProject, error: projectSelectError } = await sb
      .from('projects')
      .select('*')
      .eq('dxf_file_path', dxfPath)
      .single()

    if (projectSelectError && projectSelectError.code !== 'PGRST116') {
      console.error("[DB] Error checking project:", projectSelectError)
      throw projectSelectError
    }

    let project: Project
    if (existingProject) {
      console.log("[DB] Found existing project:", existingProject.id)
      project = existingProject as Project
    } else {
      console.log("[DB] Creating new project...")
      // Create new project
      const { data: newProject, error: projectError } = await sb
        .from('projects')
        .insert({
          dxf_file_name: fileName,
          dxf_checksum: fileName,
          dxf_file_path: dxfPath,
        })
        .select()
        .single()

      if (projectError) {
        console.error("[DB] Error creating project:", projectError)
        throw projectError
      }
      console.log("[DB] Project created:", newProject.id)
      project = newProject as Project
    }

    // Deactivate all existing sessions for this project
    console.log("[DB] Deactivating existing sessions for project:", project.id)
    await sb
      .from('sessions')
      .update({ is_active: false })
      .eq('project_id', project.id)

    // Create new session
    console.log("[DB] Creating new session for project:", project.id)
    const { data: session, error: sessionError } = await sb
      .from('sessions')
      .insert({ project_id: project.id, name: fileName, is_active: true })
      .select()
      .single()

    if (sessionError) {
      console.error("[DB] Error creating session:", sessionError)
      throw sessionError
    }

    if (!session) {
      console.error("[DB] Session insert returned null")
      throw new Error("Session insert returned null")
    }

    console.log("[DB] Session created:", session.id)

    // Verify session exists by fetching it
    const { data: verifySession } = await sb
      .from('sessions')
      .select('id')
      .eq('id', session.id)
      .single()

    if (!verifySession) {
      console.error("[DB] Session verification failed - session not found after insert")
      throw new Error("Session verification failed")
    }

    console.log("[DB] Session verified in DB:", verifySession.id)
    return { project, session: session as Session, isNewSession: true }
  }, [getSb])

  const checkForExistingSession = useCallback(async (dxfPath: string): Promise<{ project: Project; session: Session } | null> => {
    const sb = getSb()
    const { data: project } = await sb
      .from('projects')
      .select('*')
      .eq('dxf_file_path', dxfPath)
      .single()

    if (!project) return null

    const { data: session } = await sb
      .from('sessions')
      .select('*')
      .eq('project_id', project.id)
      .eq('is_active', true)
      .single()

    if (!session) return null
    return { project: project as Project, session: session as Session }
  }, [getSb])

  const checkConflict = useCallback(async (sessionId: string, localUpdatedAt: string): Promise<{ hasConflict: boolean; serverUpdatedAt: string } | null> => {
    const sb = getSb()
    const { data: session } = await sb
      .from('sessions')
      .select('updated_at')
      .eq('id', sessionId)
      .single()

    if (!session) return null

    const serverTime = new Date(session.updated_at).getTime()
    const localTime = new Date(localUpdatedAt).getTime()

    // If server was updated after local save, there's a conflict
    if (serverTime > localTime) {
      return { hasConflict: true, serverUpdatedAt: session.updated_at }
    }
    return { hasConflict: false, serverUpdatedAt: session.updated_at }
  }, [getSb])

  const loadSession = useCallback(async (sessionId: string): Promise<FullSession> => {
    const sb = getSb()
    const [
      sessionRes,
      configRes,
      digitResultsRes,
      cableSpansRes,
      polesRes,
      equipmentRes,
      trashedRes,
      opsRes,
      boundaryRes,
      dxfSegmentsRes,
    ] = await Promise.all([
      sb.from('sessions').select('*').eq('id', sessionId).single(),
      sb.from('session_config').select('*').eq('session_id', sessionId).single(),
      sb.from('digit_results').select('*').eq('session_id', sessionId),
      sb.from('cable_spans').select('*').eq('session_id', sessionId).eq('is_deleted', false),
      sb.from('poles').select('*').eq('session_id', sessionId),
      sb.from('equipment_shapes').select('*').eq('session_id', sessionId),
      sb.from('trashed_spans').select('*').eq('session_id', sessionId).is('restored_at', null),
      sb.from('span_operations').select('*').eq('session_id', sessionId).order('created_at'),
      sb.from('boundaries').select('*').eq('session_id', sessionId).single(),
      sb.from('dxf_segments').select('*').eq('session_id', sessionId),
    ])

    const spans = (cableSpansRes.data || []) as CableSpan[]

    const spansWithSegments = await Promise.all(
      spans.map(async (span) => {
        const segRes = await sb
          .from('cable_segments')
          .select('*')
          .eq('cable_span_id', span.id)
          .order('segment_index')
        return { ...span, segments: (segRes.data || []) as CableSegment[] }
      })
    )

    // Convert dxf_segments array to a layer -> segments map
    const dxfSegmentsMap: Record<string, DxfSegmentData[]> = {}
    if (dxfSegmentsRes.data) {
      for (const row of dxfSegmentsRes.data) {
        dxfSegmentsMap[row.layer] = row.segments as DxfSegmentData[]
      }
    }

    return {
      session: sessionRes.data as Session,
      config: configRes.data as SessionConfig | null,
      digit_results: (digitResultsRes.data || []) as DigitResult[],
      cable_spans: spansWithSegments,
      poles: (polesRes.data || []) as Pole[],
      equipment_shapes: (equipmentRes.data || []) as EquipmentShape[],
      trashed_spans: trashedRes.data || [],
      span_operations: (opsRes.data || []) || [],
      boundary: boundaryRes.data?.polygon as BoundaryPoint[] | null ?? null,
      dxf_segments: dxfSegmentsMap,
    }
  }, [getSb])

  const saveSpanSplit = useCallback(async (
    sessionId: string,
    originalSpanId: string,
    newSpans: Array<Omit<CableSpan, 'id' | 'session_id'> & { segments: Array<{x1:number; y1:number; x2:number; y2:number}> }>,
    cutX: number,
    cutY: number
  ) => {
    const sb = getSb()
    console.log('[DB] saveSpanSplit called, originalSpanId:', originalSpanId)

    // Find the original span by span_id and session_id
    const { data: existingSpan } = await sb
      .from('cable_spans')
      .select('id')
      .eq('session_id', sessionId)
      .eq('span_id', parseInt(originalSpanId, 10))
      .single()

    if (existingSpan) {
      // Mark original as deleted
      await sb.from('cable_spans').update({ is_deleted: true }).eq('id', existingSpan.id)
    }

    // Insert new spans using upsert to handle duplicates
    const spansToUpsert = newSpans.map(s => ({
      session_id: sessionId,
      original_span_id: parseInt(originalSpanId, 10),
      span_id: s.span_id,
      layer: s.layer || null,
      cx: s.cx ?? null,
      cy: s.cy ?? null,
      bbox: s.bbox ? [...s.bbox] : null,
      total_length: s.total_length ?? null,
      meter_value: s.meter_value ?? null,
      cable_runs: s.cable_runs ?? 1,
      from_pole: s.from_pole ?? null,
      to_pole: s.to_pole ?? null,
      is_deleted: false,
      parent_span_id: existingSpan?.id ?? null,
    }))

    console.log('[DB] Upserting spans:', spansToUpsert.map(s => ({span_id: s.span_id, layer: s.layer})))

    const { data: upsertedSpans, error: upsertError } = await sb
      .from('cable_spans')
      .upsert(spansToUpsert, { onConflict: 'session_id,span_id' })
      .select()

    if (upsertError) {
      console.error('[DB] Error upserting split spans:', upsertError)
      throw upsertError
    }

    console.log('[DB] Successfully upserted spans:', upsertedSpans?.length)

    // Insert segments for each new span
    for (const [i, span] of (upsertedSpans || []).entries()) {
      const spanData = newSpans[i]
      if (spanData.segments?.length) {
        // Delete existing segments for this span first
        await sb.from('cable_segments').delete().eq('cable_span_id', span.id)
        // Insert new segments
        await sb.from('cable_segments').insert(
          spanData.segments.map((seg, idx) => ({
            cable_span_id: span.id,
            segment_index: idx,
            x1: seg.x1,
            y1: seg.y1,
            x2: seg.x2,
            y2: seg.y2,
          }))
        )
      }
    }

    await sb.from('span_operations').insert({
      session_id: sessionId,
      operation_type: 'split',
      span_id: originalSpanId,
      metadata: {
        cut_x: cutX,
        cut_y: cutY,
        new_span_ids: (upsertedSpans || []).map((s: { id: string }) => s.id),
      },
    })

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log('[DB] Span split saved successfully')
  }, [getSb])

  const saveSpanDelete = useCallback(async (
    sessionId: string,
    spanId: string,
    spanData: CableSpan,
    status: string
  ) => {
    const sb = getSb()
    await sb.from('cable_spans').update({ is_deleted: true }).eq('id', spanId)

    await sb.from('trashed_spans').insert({
      session_id: sessionId,
      original_span_id: spanData.original_span_id,
      span_data: spanData,
      status,
    })

    await sb.from('span_operations').insert({
      session_id: sessionId,
      operation_type: 'delete',
      span_id: spanId,
      metadata: { status },
    })

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
  }, [getSb])

  const saveSpanPair = useCallback(async (
    sessionId: string,
    spanId: string,
    pairedSpanId: string,
    totalRuns: number
  ) => {
    const sb = getSb()
    await sb.from('cable_spans').update({ cable_runs: totalRuns }).eq('id', spanId)

    await sb.from('span_operations').insert({
      session_id: sessionId,
      operation_type: 'pair',
      span_id: spanId,
      metadata: { paired_span_id: pairedSpanId, total_runs: totalRuns },
    })

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
  }, [getSb])

  const restoreSpan = useCallback(async (
    sessionId: string,
    spanId: string
  ) => {
    const sb = getSb()
    
    // Find the trashed span by session_id and matching span_data.span_id
    const { data: trashedData, error: findError } = await sb
      .from('trashed_spans')
      .select('id')
      .eq('session_id', sessionId)
      .is('restored_at', null)
      .filter('span_data', 'cs', { span_id: parseInt(spanId, 10) })
      .single()
    
    if (findError || !trashedData) {
      console.error('[DB] Could not find trashed span to restore:', findError)
      return
    }

    await sb.from('cable_spans').update({ is_deleted: false }).eq('id', spanId)

    await sb.from('trashed_spans')
      .update({ restored_at: new Date().toISOString() })
      .eq('id', trashedData.id)

    await sb.from('span_operations').insert({
      session_id: sessionId,
      operation_type: 'restore',
      span_id: spanId,
      metadata: {},
    })

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
  }, [getSb])

  const saveCableSpanMetadata = useCallback(async (
    sessionId: string,
    spans: Array<{
      span_id: number
      cable_runs: number
      from_pole: string | null
      to_pole: string | null
      status: string
      meter_value: number | null
    }>
  ) => {
    const sb = getSb()
    console.log("[DB] saveCableSpanMetadata called with", spans.length, "spans")

    for (const span of spans) {
      const { error } = await sb
        .from('cable_spans')
        .upsert({
          session_id: sessionId,
          span_id: span.span_id,
          cable_runs: span.cable_runs,
          from_pole: span.from_pole,
          to_pole: span.to_pole,
          meter_value: span.meter_value,
        }, {
          onConflict: 'session_id,span_id'
        })

      if (error) {
        console.error("[DB] Error saving cable span metadata:", error)
      }
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log("[DB] Cable span metadata saved!")
  }, [getSb])

  const saveCableSpanStatuses = useCallback(async (
    sessionId: string,
    statuses: Record<string, { status: string; partial?: { recovered?: number } }>
  ) => {
    const sb = getSb()
    console.log("[DB] saveCableSpanStatuses called")

    for (const [spanId, data] of Object.entries(statuses)) {
      await sb.from('span_operations').upsert({
        session_id: sessionId,
        span_id: spanId,
        operation_type: 'status_update',
        metadata: data,
      }, {
        onConflict: 'session_id,span_id,operation_type'
      })
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
  }, [getSb])

  const saveCableSpans = useCallback(async (
    sessionId: string,
    spans: Array<{
      span_id: number
      layer: string
      bbox: number[]
      cx: number
      cy: number
      total_length: number
      meter_value: number | null
      cable_runs: number
      from_pole: string | null
      to_pole: string | null
      segments: Array<{x1: number; y1: number; x2: number; y2: number}>
    }>
  ) => {
    const sb = getSb()
    console.log('[DB] saveCableSpans called with', spans.length, 'spans')

    for (const span of spans) {
      // Upsert the cable span
      const { data: upsertedSpan, error: upsertError } = await sb
        .from('cable_spans')
        .upsert({
          session_id: sessionId,
          span_id: span.span_id,
          layer: span.layer,
          cx: span.cx,
          cy: span.cy,
          bbox: span.bbox,
          total_length: span.total_length,
          meter_value: span.meter_value,
          cable_runs: span.cable_runs,
          from_pole: span.from_pole,
          to_pole: span.to_pole,
          is_deleted: false,
        }, {
          onConflict: 'session_id,span_id'
        })
        .select()
        .single()

      if (upsertError) {
        console.error('[DB] Error upserting cable span:', upsertError)
        continue
      }

      // Delete existing segments for this span
      await sb
        .from('cable_segments')
        .delete()
        .eq('cable_span_id', upsertedSpan.id)

      // Insert new segments
      if (span.segments?.length) {
        await sb.from('cable_segments').insert(
          span.segments.map((seg, idx) => ({
            cable_span_id: upsertedSpan.id,
            segment_index: idx,
            x1: seg.x1,
            y1: seg.y1,
            x2: seg.x2,
            y2: seg.y2,
          }))
        )
      }
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log('[DB] Cable spans saved successfully')
  }, [getSb])

  const saveSession = useCallback(async (
    sessionId: string,
    data: {
      digit_results: DigitResult[]
      cable_spans: CableSpan[]
      poles: Pole[]
      equipment_shapes: EquipmentShape[]
    }
  ) => {
    const sb = getSb()
    console.log("[DB] saveSession called for session:", sessionId)
    console.log("[DB] digit_results count:", data.digit_results.length)

    // Verify session exists
    const { data: verifySession } = await sb
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .single()

    if (!verifySession) {
      console.error("[DB] Session does not exist:", sessionId)
      throw new Error(`Session ${sessionId} does not exist in database`)
    }

    if (data.digit_results.length > 0) {
      console.log("[DB] Upserting digit_results...")
      const resultsToSave = data.digit_results.map(r => {
        const { id, ...rest } = r
        return { ...rest, session_id: sessionId }
      })
      console.log("[DB] First result:", JSON.stringify(resultsToSave[0]))
      console.log("[DB] All results:", JSON.stringify(resultsToSave))
      
      const { data: upsertData, error: digitError } = await sb
        .from('digit_results')
        .upsert(resultsToSave, { onConflict: 'session_id,digit_id' })
        .select()

      if (digitError) {
        console.error("[DB] Error upserting digit_results:", JSON.stringify(digitError, null, 2))
        console.error("[DB] Error message:", digitError?.message)
        console.error("[DB] Error code:", digitError?.code)
        console.error("[DB] Error details:", digitError?.details)
        console.error("[DB] Error hint:", digitError?.hint)
        throw digitError
      }
      console.log("[DB] digit_results upserted:", upsertData?.length, "records")
    }

    if (data.poles.length > 0) {
      console.log("[DB] Upserting poles...")
      const { error: poleError } = await sb
        .from('poles')
        .upsert(
          data.poles.map(p => {
            const { id, ...rest } = p
            return { ...rest, session_id: sessionId }
          }),
          { onConflict: 'session_id,pole_id' }
        )

      if (poleError) {
        console.error("[DB] Error upserting poles:", poleError)
        throw poleError
      }
    }

    if (data.equipment_shapes.length > 0) {
      console.log("[DB] Upserting equipment_shapes...")
      const { error: equipError } = await sb
        .from('equipment_shapes')
        .upsert(
          data.equipment_shapes.map(e => {
            const { id, ...rest } = e
            return { ...rest, session_id: sessionId }
          }),
          { onConflict: 'session_id,shape_id' }
        )

      if (equipError) {
        console.error("[DB] Error upserting equipment_shapes:", equipError)
        throw equipError
      }
    }

    console.log("[DB] Updating session updated_at...")
    const { error: sessionError } = await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    if (sessionError) {
      console.error("[DB] Error updating session:", sessionError)
      throw sessionError
    }
    console.log("[DB] Session saved successfully!")
  }, [getSb])

  const deleteSession = useCallback(async (sessionId: string) => {
    const sb = getSb()
    const { error } = await sb.from('sessions').delete().eq('id', sessionId)
    if (error) throw error
  }, [getSb])

  const setActiveSession = useCallback(async (sessionId: string, projectId: string) => {
    const sb = getSb()
    await sb
      .from('sessions')
      .update({ is_active: false })
      .eq('project_id', projectId)

    await sb
      .from('sessions')
      .update({ is_active: true })
      .eq('id', sessionId)
  }, [getSb])

  // =====================================================
  // NEW: Session Summary for restore dialog
  // =====================================================
  
  const getSessionSummary = useCallback(async (dxfPath: string): Promise<SessionSummary | null> => {
    const sb = getSb()
    
    // Find project by file path
    const { data: project } = await sb
      .from('projects')
      .select('*')
      .eq('dxf_file_path', dxfPath)
      .single()

    if (!project) return null

    // Find active session
    const { data: session } = await sb
      .from('sessions')
      .select('*')
      .eq('project_id', project.id)
      .eq('is_active', true)
      .single()

    if (!session) return null

    // Get counts and config in parallel
    const [configRes, digitCountRes, equipCountRes, poleCountRes, spanCountRes, boundaryRes] = await Promise.all([
      sb.from('session_config').select('*').eq('session_id', session.id).single(),
      sb.from('digit_results').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
      sb.from('equipment_shapes').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
      sb.from('poles').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
      sb.from('cable_spans').select('id', { count: 'exact', head: true }).eq('session_id', session.id).eq('is_deleted', false),
      sb.from('boundaries').select('id').eq('session_id', session.id).single(),
    ])

    return {
      session: session as Session,
      project: project as Project,
      config: configRes.data as SessionConfig | null,
      counts: {
        digit_results: digitCountRes.count ?? 0,
        equipment_shapes: equipCountRes.count ?? 0,
        poles: poleCountRes.count ?? 0,
        cable_spans: spanCountRes.count ?? 0,
        has_boundary: !!boundaryRes.data,
      },
    }
  }, [getSb])

  // =====================================================
  // NEW: Granular save methods for auto-save
  // =====================================================

  const saveDigitResults = useCallback(async (sessionId: string, results: DigitResult[]) => {
    if (results.length === 0) return
    const sb = getSb()
    
    const resultsToSave = results.map(r => {
      const { id, ...rest } = r
      return { ...rest, session_id: sessionId }
    })

    const { error } = await sb
      .from('digit_results')
      .upsert(resultsToSave, { onConflict: 'session_id,digit_id' })

    if (error) {
      console.error("[DB] Error saving digit_results:", error)
      throw error
    }
    
    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log("[DB] Saved", results.length, "digit results")
  }, [getSb])

  const saveEquipmentShapes = useCallback(async (sessionId: string, shapes: EquipmentShape[]) => {
    if (shapes.length === 0) return
    const sb = getSb()

    const shapesToSave = shapes.map(s => {
      const { id, ...rest } = s
      return { ...rest, session_id: sessionId }
    })

    const { error } = await sb
      .from('equipment_shapes')
      .upsert(shapesToSave, { onConflict: 'session_id,shape_id' })

    if (error) {
      console.error("[DB] Error saving equipment_shapes:", error)
      throw error
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log("[DB] Saved", shapes.length, "equipment shapes")
  }, [getSb])

  const savePoles = useCallback(async (sessionId: string, poles: Pole[]) => {
    if (poles.length === 0) return
    const sb = getSb()

    const polesToSave = poles.map(p => {
      const { id, ...rest } = p
      return { ...rest, session_id: sessionId }
    })

    const { error } = await sb
      .from('poles')
      .upsert(polesToSave, { onConflict: 'session_id,pole_id' })

    if (error) {
      console.error("[DB] Error saving poles:", error)
      throw error
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log("[DB] Saved", poles.length, "poles")
  }, [getSb])

  const saveBoundary = useCallback(async (sessionId: string, polygon: BoundaryPoint[]) => {
    const sb = getSb()

    const { error } = await sb
      .from('boundaries')
      .upsert({
        session_id: sessionId,
        polygon: polygon,
      }, { onConflict: 'session_id' })

    if (error) {
      console.error("[DB] Error saving boundary:", error)
      throw error
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log("[DB] Saved boundary polygon with", polygon.length, "points")
  }, [getSb])

  const saveSessionConfig = useCallback(async (
    sessionId: string, 
    config: Partial<Omit<SessionConfig, 'id' | 'session_id' | 'updated_at'>>
  ) => {
    const sb = getSb()

    const { error } = await sb
      .from('session_config')
      .upsert({
        session_id: sessionId,
        ...config,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'session_id' })

    if (error) {
      console.error("[DB] Error saving session config:", error)
      throw error
    }

    console.log("[DB] Saved session config")
  }, [getSb])

  const saveDxfSegments = useCallback(async (
    sessionId: string, 
    layer: string, 
    segments: DxfSegmentData[]
  ) => {
    const sb = getSb()

    const { error } = await sb
      .from('dxf_segments')
      .upsert({
        session_id: sessionId,
        layer: layer,
        segments: segments,
      }, { onConflict: 'session_id,layer' })

    if (error) {
      console.error("[DB] Error saving DXF segments:", error)
      throw error
    }

    console.log("[DB] Saved", segments.length, "DXF segments for layer:", layer)
  }, [getSb])

  // Bulk save all DXF segments at once
  const saveDxfSegmentsBulk = useCallback(async (
    sessionId: string,
    segmentsByLayer: Record<string, DxfSegmentData[]>
  ) => {
    const sb = getSb()
    
    const rows = Object.entries(segmentsByLayer).map(([layer, segments]) => ({
      session_id: sessionId,
      layer,
      segments,
    }))

    if (rows.length === 0) return

    const { error } = await sb
      .from('dxf_segments')
      .upsert(rows, { onConflict: 'session_id,layer' })

    if (error) {
      console.error("[DB] Error bulk saving DXF segments:", error)
      throw error
    }

    console.log("[DB] Bulk saved DXF segments for", rows.length, "layers")
  }, [getSb])

  // =====================================================
  // NEW: Clear session data (for re-scan)
  // =====================================================
  
  const clearSessionData = useCallback(async (sessionId: string, dataTypes: ('ocr' | 'equipment' | 'poles' | 'all')[]) => {
    const sb = getSb()
    
    const clearAll = dataTypes.includes('all')
    
    if (clearAll || dataTypes.includes('ocr')) {
      await sb.from('digit_results').delete().eq('session_id', sessionId)
      await sb.from('session_config').update({ ocr_done: false }).eq('session_id', sessionId)
    }
    
    if (clearAll || dataTypes.includes('equipment')) {
      await sb.from('equipment_shapes').delete().eq('session_id', sessionId)
      await sb.from('boundaries').delete().eq('session_id', sessionId)
      await sb.from('session_config').update({ equipment_done: false }).eq('session_id', sessionId)
    }
    
    if (clearAll || dataTypes.includes('poles')) {
      await sb.from('poles').delete().eq('session_id', sessionId)
      await sb.from('session_config').update({ poles_done: false }).eq('session_id', sessionId)
    }

    await sb.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
    console.log("[DB] Cleared session data:", dataTypes)
  }, [getSb])

  return {
    isConfigured,
    initProject,
    getProjects,
    createSession,
    getSessions,
    getActiveSession,
    loadSession,
    saveSpanSplit,
    saveSpanDelete,
    saveSpanPair,
    restoreSpan,
    saveSession,
    saveCableSpanMetadata,
    saveCableSpanStatuses,
    saveCableSpans,
    deleteSession,
    setActiveSession,
    getOrCreateSessionForFile,
    checkForExistingSession,
    checkConflict,
    // New methods
    getSessionSummary,
    saveDigitResults,
    saveEquipmentShapes,
    savePoles,
    saveBoundary,
    saveSessionConfig,
    saveDxfSegments,
    saveDxfSegmentsBulk,
    clearSessionData,
  }
}
