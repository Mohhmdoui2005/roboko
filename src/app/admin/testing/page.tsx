'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Countdown from '@/components/Countdown'

interface ActiveSession {
  session_id: string
  robot_id: string
  robot_name: string
  arena_id: string | null
  started_at: string
  ends_at: string
}

const TOTAL_ARENAS = 8

export default function AdminTestingPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const supabase = createClient()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_active_sessions')
    if (!error && data) setSessions(data as ActiveSession[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchSessions()
    pollRef.current = setInterval(fetchSessions, 5000) // 5 s polling, no realtime
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchSessions])

  const handleEndSession = useCallback(async (sessionId: string) => {
    setProcessing(sessionId)
    const { error } = await supabase.rpc('end_test_session', { p_session_id: sessionId })
    if (error) {
      setStatusMsg({ ok: false, text: `Error: ${error.message}` })
    } else {
      setStatusMsg({ ok: true, text: 'Session ended successfully.' })
      fetchSessions()
    }
    setProcessing(null)
    setConfirmEnd(null)
    setTimeout(() => setStatusMsg(null), 4000)
  }, [supabase, fetchSessions])

  const occupied = sessions.length
  const available = Math.max(0, TOTAL_ARENAS - occupied)

  return (
    <div className="min-h-screen p-5 space-y-6" style={{ background: 'var(--color-bg)' }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '1.25rem' }}>
        <div className="flex items-center gap-3">
          <Link href="/admin" className="btn" style={{ minHeight: 40 }}>← Dashboard</Link>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em', fontFamily: 'var(--font-heading)', margin: 0 }}>
            Test Room <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>— Admin</span>
          </h1>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
          5 s polling · No realtime connections · Manual override available
        </p>
      </div>

      {/* ── Status message ── */}
      {statusMsg && (
        <div
          className={statusMsg.ok ? 'toast-success' : 'toast-danger'}
          style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500 }}
          role="alert"
        >
          {statusMsg.ok ? 'OK — ' : 'ERR — '} {statusMsg.text}
        </div>
      )}

      {/* ── Occupancy summary ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-5">
          <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Occupied
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-heading)', lineHeight: 1, color: 'var(--color-accent)' }}>
            {occupied}
            <span style={{ fontSize: '1rem', fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>/ {TOTAL_ARENAS}</span>
          </p>
        </div>
        <div className="card p-5">
          <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Available
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-heading)', lineHeight: 1, color: 'var(--color-text-primary)' }}>
            {available}
          </p>
        </div>
      </div>

      {/* ── Sessions table ── */}
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
            Loading…
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            No active test sessions at the moment.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Arena</th>
                  <th>Started</th>
                  <th>Ends At</th>
                  <th>Time Left</th>
                  <th style={{ textAlign: 'center' }}>Override</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{s.robot_name}</td>
                    <td>{s.arena_id ?? '—'}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(s.started_at).toLocaleTimeString()}</td>
                    <td style={{ color: 'var(--color-text-tertiary)' }}>{new Date(s.ends_at).toLocaleTimeString()}</td>
                    <td><Countdown endsAt={s.ends_at} offsetMs={0} /></td>
                    <td style={{ textAlign: 'center' }}>
                      {confirmEnd === s.session_id ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <button
                            disabled={processing === s.session_id}
                            onClick={() => handleEndSession(s.session_id)}
                            className="btn btn-danger"
                            style={{ minHeight: 36, padding: '0 0.875rem', fontSize: '0.8125rem' }}
                          >
                            {processing === s.session_id ? 'Ending…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmEnd(null)}
                            className="btn"
                            style={{ minHeight: 36, padding: '0 0.875rem', fontSize: '0.8125rem' }}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmEnd(s.session_id)}
                          className="btn"
                          style={{ minHeight: 36, padding: '0 0.875rem', fontSize: '0.8125rem',
                            borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
                        >
                          End Session
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
