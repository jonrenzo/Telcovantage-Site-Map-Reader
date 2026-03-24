"use client"

import { useState, useEffect } from 'react'
import { useDatabase } from '../hooks/useDatabase'
import type { Project, Session, FullSession } from '../lib/supabase'

interface Props {
  dxfPath?: string
  onLoadSession: (data: FullSession | { isNewProject: true; dxfPath: string }) => void
  onClose: () => void
  mode?: 'load' | 'save'
}

export default function SessionManager({ dxfPath, onLoadSession, onClose, mode = 'load' }: Props) {
  const { getProjects, getSessions, createSession, loadSession, initProject, deleteSession, setActiveSession } = useDatabase()
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'projects' | 'sessions'>(mode === 'save' ? 'sessions' : 'projects')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProjects = async () => {
    try {
      const data = await getProjects()
      setProjects(data)
    } catch {
      setError('Failed to load projects')
    }
  }

  const loadSessions = async (project: Project) => {
    setLoading(true)
    try {
      setSelectedProject(project)
      const data = await getSessions(project.id)
      setSessions(data)
      setView('sessions')
    } catch {
      setError('Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  const handleLoadSession = async (session: Session) => {
    setLoading(true)
    try {
      const fullSession = await loadSession(session.id)
      await setActiveSession(session.id, session.project_id)
      onLoadSession(fullSession)
    } catch {
      setError('Failed to load session')
    } finally {
      setLoading(false)
    }
  }

  const handleNewSession = async () => {
    if (!selectedProject) return
    setLoading(true)
    try {
      const newSession = await createSession(selectedProject.id, selectedProject.dxf_file_name)
      const fullSession = await loadSession(newSession.id)
      onLoadSession(fullSession)
    } catch {
      setError('Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  const handleNewProject = async () => {
    if (!dxfPath) return
    setLoading(true)
    try {
      const fileName = dxfPath.split(/[\\\/]/).pop() || 'unknown'
      const checksum = fileName
      const { project } = await initProject(dxfPath, checksum)
      const newSession = await createSession(project.id, project.dxf_file_name)
      const fullSession = await loadSession(newSession.id)
      onLoadSession(fullSession)
    } catch {
      setError('Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete session "${session.name}"? This cannot be undone.`)) return
    try {
      await deleteSession(session.id)
      if (selectedProject) {
        const data = await getSessions(selectedProject.id)
        setSessions(data)
      }
    } catch {
      setError('Failed to delete session')
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-surface">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7" />
              <ellipse cx="12" cy="7" rx="8" ry="4" />
            </svg>
            {mode === 'save' ? 'Save Session' : 'Load Session'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {view === 'projects' && (
            <div className="space-y-3">
              <p className="text-sm text-muted mb-4">Select a project to view its sessions:</p>
              {projects.map(project => (
                <button
                  key={project.id}
                  onClick={() => loadSessions(project)}
                  disabled={loading}
                  className="w-full text-left p-4 border border-border rounded-lg hover:border-accent hover:bg-accent-light transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{project.dxf_file_name}</div>
                      <div className="text-xs text-muted mt-0.5">
                        Created {formatDate(project.created_at)}
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </div>
                </button>
              ))}
              {projects.length === 0 && (
                <div className="text-center py-12 text-muted">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-2 flex items-center justify-center">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7" />
                      <ellipse cx="12" cy="7" rx="8" ry="4" />
                    </svg>
                  </div>
                  <p className="font-medium">No saved projects yet</p>
                  <p className="text-sm mt-1">Start a new session to get started</p>
                </div>
              )}
              {dxfPath && (
                <button
                  onClick={handleNewProject}
                  disabled={loading}
                  className="w-full mt-4 py-3 border-2 border-dashed border-accent rounded-lg text-accent hover:bg-accent-light transition font-medium"
                >
                  {loading ? 'Creating...' : '+ Start new project with current file'}
                </button>
              )}
            </div>
          )}

          {view === 'sessions' && selectedProject && (
            <div>
              <button
                onClick={() => { setSelectedProject(null); setView('projects') }}
                className="text-sm text-accent hover:underline mb-4 flex items-center gap-1"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Back to projects
              </button>

              <div className="flex items-center gap-3 mb-4 p-3 bg-surface-2 rounded-lg">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold">{selectedProject.dxf_file_name}</div>
                  <div className="text-xs text-muted">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</div>
                </div>
              </div>

              <div className="space-y-2">
                {sessions.map(session => (
                  <div
                    key={session.id}
                    className={`p-4 border rounded-lg cursor-pointer transition ${
                      session.is_active
                        ? 'border-ok bg-ok-light'
                        : 'border-border hover:border-accent hover:bg-accent-light'
                    }`}
                    onClick={() => handleLoadSession(session)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${session.is_active ? 'bg-ok' : 'bg-muted'}`} />
                        <span className="font-medium">{session.name}</span>
                        {session.is_active && (
                          <span className="text-[10px] bg-ok text-white px-2 py-0.5 rounded font-semibold">Active</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">{formatDate(session.created_at)}</span>
                        <button
                          onClick={(e) => handleDeleteSession(session, e)}
                          className="text-muted hover:text-red-500 p-1"
                          title="Delete session"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {session.updated_at !== session.created_at && (
                      <div className="text-[10px] text-muted mt-1">
                        Last updated: {formatDate(session.updated_at)}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={handleNewSession}
                disabled={loading}
                className="w-full mt-4 py-3 border-2 border-dashed border-accent rounded-lg text-accent hover:bg-accent-light transition font-medium"
              >
                {loading ? 'Creating...' : `+ Create new session for ${selectedProject.dxf_file_name}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
