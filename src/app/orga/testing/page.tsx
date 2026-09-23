'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { parseQRScanPayload } from '@/lib/qr'
import Countdown from '@/components/Countdown'

const QRScanner = dynamic(() => import('@/components/QRScanner'), { ssr: false })

interface ActiveSession {
  session_id: string
  robot_id: string
  robot_name: string
  arena_id: string | null
  started_at: string
  ends_at: string
}

interface Toast {
  id: number
  success: boolean
  message: string
}

let toastCounter = 0

export default function OrgaTestingPage() {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [expired, setExpired] = useState<ActiveSession[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [loading, setLoading] = useState(true)
  const [processingClear, setProcessingClear] = useState<string | null>(null)
  const supabase = createClient()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Sessions the orga already cleared (or confirmed) — the next poll dropping
  // them is expected, not a time-up.
  const clearedRef = useRef<Set<string>>(new Set())
  // Last poll's sessions — lets us notice rows the server stopped returning.
  const lastSeenRef = useRef<Map<string, ActiveSession>>(new Map())

  const pushToast = useCallback((success: boolean, message: string) => {
    const id = ++toastCounter
    setToasts((prev) => [...prev, { id, success, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  // A session hit zero and still needs a human to escort the participant out.
  // Persistent (not a 4 s toast) + deduped — poll-drop and row-countdown can
  // both report the same session.
  const markExpired = useCallback((s: ActiveSession) => {
    setExpired(prev => prev.some(e => e.session_id === s.session_id) ? prev : [...prev, s])
    try { navigator.vibrate(200) } catch { /* unsupported — visual alert stands */ }
  }, [])

  const handleRowExpired = useCallback((s: ActiveSession) => {
    if (clearedRef.current.has(s.session_id)) return
    markExpired(s)
  }, [markExpired])

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_active_sessions')
    if (!error && data) {
      const seen = data as ActiveSession[]
      setSessions(seen)
      const seenIds = new Set(seen.map(s => s.session_id))
      // Server stops returning a session once ends_at passes (or it was
      // ended). Only flag natural expiry — an early admin end is not a
      // time-up, and a force-cleared row is already handled.
      lastSeenRef.current.forEach((s, id) => {
        if (seenIds.has(id) || clearedRef.current.has(id)) return
        if (new Date(s.ends_at).getTime() <= Date.now()) markExpired(s)
      })
      lastSeenRef.current = new Map(seen.map(s => [s.session_id, s]))
    }
    setLoading(false)
  }, [supabase, markExpired])

  useEffect(() => {
    fetchSessions()
    pollRef.current = setInterval(fetchSessions, 5000) // 5 s polling, no realtime
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchSessions])

  const handleScan = useCallback(async (raw: string) => {
    const parsed = parseQRScanPayload(raw)
    if (!parsed || parsed.domain !== 'ROBOT_TEST') {
      pushToast(false, 'Invalid QR: expected a ROBOT_TEST payload.')
      return
    }
    const { data, error } = await supabase.rpc('start_test_session', { p_robot_id: parsed.robot_id })
    if (error) {
      pushToast(false, `Error: ${error.message}`)
    } else {
      pushToast(true, `Session started for "${data?.robot_name || parsed.robot_id.slice(0, 8)}"`)
      fetchSessions()
    }
  }, [supabase, pushToast, fetchSessions])

  const handleForceClear = useCallback(async (sessionId: string, robotName: string) => {
    setProcessingClear(sessionId)
    clearedRef.current.add(sessionId)
    setExpired(prev => prev.filter(e => e.session_id !== sessionId))
    const { error } = await supabase.rpc('end_test_session', { p_session_id: sessionId })
    if (error) {
      pushToast(false, `Could not end session: ${error.message}`)
    } else {
      pushToast(true, `Session for "${robotName}" ended.`)
      fetchSessions()
    }
    setProcessingClear(null)
  }, [supabase, pushToast, fetchSessions])

  // Orga confirms the participant was escorted out — closes the session
  // server-side (or just clears the alert if it already ended elsewhere).
  const handleConfirmRemoval = useCallback(async (s: ActiveSession) => {
    setProcessingClear(s.session_id)
    clearedRef.current.add(s.session_id)
    const { error } = await supabase.rpc('end_test_session', { p_session_id: s.session_id })
    setExpired(prev => prev.filter(e => e.session_id !== s.session_id))
    if (error) {
      pushToast(false, `Note: ${error.message} — removed from the list anyway.`)
    } else {
      pushToast(true, `"${s.robot_name}" removed from ${s.arena_id ?? 'the test room'}.`)
      fetchSessions()
    }
    setProcessingClear(null)
  }, [supabase, pushToast, fetchSessions])

  return (
    <div className="min-h-screen p-5 space-y-6" style={{ background: 'var(--color-bg)' }}>

      {/* ── Header ── */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em', fontFamily: 'var(--font-heading)', margin: 0 }}>
            Test Room <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>— Orga</span>
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Scan robot QR codes · 5 s polling · No realtime connections
          </p>
        </div>
        <button
          onClick={() => setScannerOpen(true)}
          className="btn btn-primary"
          style={{ gap: '0.5rem' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Scan Robot QR
        </button>
      </div>

      {/* ── Toast notifications ── */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" style={{ width: 320 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={t.success ? 'toast-success' : 'toast-danger'}
            style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500 }}
          >
            {t.success ? 'OK — ' : 'ERR — '} {t.message}
          </div>
        ))}
      </div>

      {/* ── TIME UP — escort out, then confirm ── */}
      {expired.length > 0 && (
        <div className="card overflow-hidden" style={{ border: '2px solid var(--color-danger)' }}>
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--color-danger)' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-danger)', margin: 0 }}>
              TIME UP — get {expired.length === 1 ? 'this participant' : 'these participants'} out of the room
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Escort them out, then confirm removal to close the session.
            </p>
          </div>
          {expired.map(s => (
            <div key={s.session_id} className="flex items-center gap-3 px-5 py-3 flex-wrap"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              <div className="flex-1" style={{ minWidth: 180 }}>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {s.robot_name}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                  {s.arena_id ?? 'Test room'} · ended {new Date(s.ends_at).toLocaleTimeString()}
                </p>
              </div>
              <button
                disabled={processingClear === s.session_id}
                onClick={() => handleConfirmRemoval(s)}
                className="btn btn-danger"
                style={{ minHeight: 48, padding: '0 1rem', fontSize: '0.85rem' }}
              >
                {processingClear === s.session_id ? 'Confirming…' : 'Confirm removal'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Active sessions table ── */}
      <div className="card card-emphasized overflow-hidden">
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
            Active Sessions
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
            auto-refreshes every 5 s
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            Loading sessions…
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            No active test sessions right now.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Arena</th>
                  <th>Started</th>
                  <th>Time Left</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{s.robot_name}</td>
                    <td>{s.arena_id ?? '—'}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(s.started_at).toLocaleTimeString()}</td>
                    <td><Countdown endsAt={s.ends_at} offsetMs={0} onExpired={() => handleRowExpired(s)} /></td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        disabled={processingClear === s.session_id}
                        onClick={() => handleForceClear(s.session_id, s.robot_name)}
                        className="btn btn-danger"
                        style={{ minHeight: 36, padding: '0 0.875rem', fontSize: '0.8125rem' }}
                      >
                        {processingClear === s.session_id ? 'Clearing…' : 'Force Clear'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── QR Scanner modal ── */}
      {scannerOpen && (
        <QRScanner
          onScan={(raw) => { handleScan(raw) }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}
